/**
 * The only file that touches the ONNX runtime API. Engines ask for a session by
 * (modelId, fileName); this manager lazily creates it from the model-store path, picks an
 * execution provider (manifest preference order, filtered per platform, with the last EP that
 * actually worked remembered per model), and LRU-unloads whole model groups under memory
 * pressure. Swapping runtimes (nitro-onnxruntime, ExecuTorch) if the S1 spike fails is
 * contained here by design.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import type { InferenceSession } from 'onnxruntime-react-native';

import { manifestById, type ExecutionProviderName } from './manifest';
import { isModelInstalled, modelFilePath } from './model-store';
import { drainPool } from './tensors';

/** Model groups kept loaded at once (detector + manga-ocr enc/dec = one group each). */
const MAX_LOADED_MODELS = 2;
const EP_MEMO_PREFIX = 'comical:translator:ep:';

type ModelSessions = { files: Map<string, InferenceSession>; lastUsed: number };

const loaded = new Map<string, ModelSessions>();

function platformEps(preferred: ExecutionProviderName[]): string[] {
  const usable = preferred.filter((ep) =>
    ep === 'coreml' ? Platform.OS === 'ios' : ep === 'nnapi' ? Platform.OS === 'android' : true,
  );
  return [...usable, 'cpu'];
}

export async function session(modelId: string, fileName: string): Promise<InferenceSession> {
  const group = loaded.get(modelId);
  const existing = group?.files.get(fileName);
  if (existing) {
    group!.lastUsed = Date.now();
    return existing;
  }

  const manifest = manifestById(modelId);
  if (!manifest) throw new Error(`unknown model: ${modelId}`);
  if (!isModelInstalled(manifest)) throw new Error(`model not installed: ${modelId}`);

  await evictBeyond(MAX_LOADED_MODELS - 1, modelId);

  // Static import would drag the native binding into web/test bundles that never run it.
  const ort = await import('onnxruntime-react-native');
  const path = modelFilePath(manifest, fileName).replace(/^file:\/\//, '');

  const memoKey = `${EP_MEMO_PREFIX}${modelId}`;
  const remembered = await AsyncStorage.getItem(memoKey);
  const candidates = platformEps(manifest.runtime.eps);
  if (remembered && candidates.includes(remembered)) {
    candidates.splice(candidates.indexOf(remembered), 1);
    candidates.unshift(remembered);
  }

  let lastError: unknown;
  for (const ep of candidates) {
    try {
      const created = await ort.InferenceSession.create(path, {
        executionProviders: [ep as never],
      });
      const entry = loaded.get(modelId) ?? { files: new Map(), lastUsed: Date.now() };
      entry.files.set(fileName, created);
      entry.lastUsed = Date.now();
      loaded.set(modelId, entry);
      void AsyncStorage.setItem(memoKey, ep);
      return created;
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(`cannot create session for ${modelId}/${fileName}: ${String(lastError)}`);
}

export function releaseModel(modelId: string): void {
  const group = loaded.get(modelId);
  if (!group) return;
  loaded.delete(modelId);
  for (const s of group.files.values()) {
    void s.release();
  }
}

/** Memory-pressure / reader-idle path: drop every session and the tensor pool. */
export function releaseAllSessions(): void {
  for (const id of [...loaded.keys()]) releaseModel(id);
  drainPool();
}

async function evictBeyond(max: number, keeping: string): Promise<void> {
  while (loaded.size > Math.max(0, max)) {
    let oldest: string | null = null;
    let oldestAt = Infinity;
    for (const [id, group] of loaded) {
      if (id === keeping) continue;
      if (group.lastUsed < oldestAt) {
        oldestAt = group.lastUsed;
        oldest = id;
      }
    }
    if (!oldest) return;
    releaseModel(oldest);
  }
}
