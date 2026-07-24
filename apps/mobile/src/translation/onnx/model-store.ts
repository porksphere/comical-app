/**
 * Download, verify, store, and delete the ONNX model artifacts described by `manifest.ts`.
 *
 * Layout: `Paths.document/translator-models/${id}-${version}/${file.name}` — document (not
 * cache) storage because the OS reclaiming an 80–130 MB model under disk pressure would mean a
 * silent full re-download; version-in-dirname is content addressing at the model level (an
 * update lands in a new dir; stale dirs are swept at startup, like `pruneBundleCache`).
 *
 * Downloads stream through `expo/fetch` into a `.part` file with an *incremental* sha256
 * (@noble/hashes) — a 130 MB artifact never exists in memory whole. Interrupted downloads
 * resume with a `Range` header after re-seeding the hash from the existing `.part` bytes; a
 * server that ignores Range just restarts the file. Hash mismatch deletes and errors.
 *
 * Progress is mirrored into the react-query entry `queryKeys.translatorModels()` (throttled
 * patch during the stream, authoritative invalidate at terminal states) so the settings screen
 * reuses the downloads UI components unchanged.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';

import { queryClient } from '@/data/query-client';
import { queryKeys } from '@/data/queries';
import { isPublished, manifestById, MODEL_MANIFESTS, type OnnxModelManifest } from './manifest';

const MODELS_DIR = 'translator-models';
const PROGRESS_PATCH_MS = 300;
const HASH_CHUNK_BYTES = 1 << 20; // 1 MiB reads while re-seeding a resumed download's hash

export type ModelState = 'absent' | 'downloading' | 'ready' | 'error' | 'unpublished';

export type ModelStatus = {
  id: string;
  displayName: string;
  state: ModelState;
  receivedBytes: number;
  totalBytes: number;
  error?: string;
};

function modelsRoot(): Directory {
  return new Directory(Paths.document, MODELS_DIR);
}

export function modelDir(manifest: OnnxModelManifest): Directory {
  return new Directory(modelsRoot(), `${manifest.id}-${manifest.version}`);
}

export function modelFilePath(manifest: OnnxModelManifest, name: string): string {
  return new File(modelDir(manifest), name).uri;
}

export function isModelInstalled(manifest: OnnxModelManifest): boolean {
  try {
    return manifest.files.every((f) => {
      const file = new File(modelDir(manifest), f.name);
      return file.exists && file.size === f.bytes;
    });
  } catch {
    return false;
  }
}

// ── status mirror (react-query is the UI's subscription surface) ──────────────────────────────

const active = new Map<string, { received: number; abort: AbortController }>();
let lastPatch = 0;

export function modelStatuses(): ModelStatus[] {
  return MODEL_MANIFESTS.map((m) => {
    const inflight = active.get(m.id);
    const state: ModelState = inflight
      ? 'downloading'
      : !isPublished(m)
        ? 'unpublished'
        : isModelInstalled(m)
          ? 'ready'
          : 'absent';
    return {
      id: m.id,
      displayName: m.displayName,
      state,
      receivedBytes: inflight?.received ?? 0,
      totalBytes: m.totalBytes,
    };
  });
}

function publishStatuses(force: boolean): void {
  const now = Date.now();
  if (!force && now - lastPatch < PROGRESS_PATCH_MS) return;
  lastPatch = now;
  queryClient.setQueryData(queryKeys.translatorModels(), modelStatuses());
}

// ── download / delete ──────────────────────────────────────────────────────────────────────────

export function isModelDownloading(id: string): boolean {
  return active.has(id);
}

export function cancelModelDownload(id: string): void {
  active.get(id)?.abort.abort();
}

/**
 * Download every file of `id`'s manifest (sequentially — these are large and the win is
 * resumability, not parallelism). Resolves when the model is fully verified on disk.
 */
export async function downloadModel(id: string): Promise<void> {
  const manifest = manifestById(id);
  if (!manifest) throw new Error(`unknown model: ${id}`);
  if (!isPublished(manifest)) throw new Error(`${manifest.displayName}: artifacts not yet published`);
  if (active.has(id)) throw new Error(`${manifest.displayName}: download already running`);
  if (isModelInstalled(manifest)) return;

  const free = Paths.availableDiskSpace;
  if (free != null && free < manifest.totalBytes * 1.1) {
    throw new Error(`${manifest.displayName}: not enough free space`);
  }

  const abort = new AbortController();
  const track = { received: alreadyDownloadedBytes(manifest), abort };
  active.set(id, track);
  publishStatuses(true);
  try {
    const dir = modelDir(manifest);
    if (!dir.exists) dir.create({ intermediates: true });
    for (const spec of manifest.files) {
      const target = new File(dir, spec.name);
      if (target.exists && target.size === spec.bytes) continue;
      await downloadFile(manifest, spec.name, abort.signal, (delta) => {
        track.received += delta;
        publishStatuses(false);
      });
    }
  } finally {
    active.delete(id);
    publishStatuses(true);
    void queryClient.invalidateQueries({ queryKey: queryKeys.translatorModels() });
  }
}

export function deleteModel(id: string): void {
  const manifest = manifestById(id);
  if (!manifest) return;
  cancelModelDownload(id);
  try {
    const dir = modelDir(manifest);
    if (dir.exists) dir.delete();
  } catch {
    // best-effort; a stray dir is swept at next startup
  }
  publishStatuses(true);
}

/** Sweep model dirs whose (id, version) no longer matches a manifest. Call once at startup. */
export function pruneModelStore(): void {
  try {
    const root = modelsRoot();
    if (!root.exists) return;
    const valid = new Set(MODEL_MANIFESTS.map((m) => `${m.id}-${m.version}`));
    for (const entry of root.list()) {
      if (entry instanceof Directory && !valid.has(entry.name)) {
        try {
          entry.delete();
        } catch {
          /* best-effort */
        }
      }
    }
  } catch {
    /* best-effort */
  }
}

function alreadyDownloadedBytes(manifest: OnnxModelManifest): number {
  let total = 0;
  for (const spec of manifest.files) {
    const done = new File(modelDir(manifest), spec.name);
    if (done.exists && done.size === spec.bytes) total += spec.bytes;
  }
  return total;
}

async function downloadFile(
  manifest: OnnxModelManifest,
  name: string,
  signal: AbortSignal,
  onBytes: (delta: number) => void,
): Promise<void> {
  const spec = manifest.files.find((f) => f.name === name);
  if (!spec) throw new Error(`no such file in manifest: ${name}`);
  const dir = modelDir(manifest);
  const part = new File(dir, `${name}.part`);

  // Seed the incremental hash from any existing partial file; resume from its end.
  const hash = sha256.create();
  let offset = 0;
  if (part.exists && (part.size ?? 0) > 0 && (part.size ?? 0) < spec.bytes) {
    offset = seedHashFromPart(part, hash);
    onBytes(offset); // the partial's bytes count toward progress on this run
  } else if (part.exists) {
    part.delete();
  }

  const res = await expoFetch(spec.url, {
    signal,
    headers: offset > 0 ? { Range: `bytes=${offset}-` } : undefined,
  });
  if (res.status === 200 && offset > 0) {
    // Server ignored Range — restart the file and the hash from scratch.
    part.delete();
    onBytes(-offset);
    return downloadFile(manifest, name, signal, onBytes);
  }
  if (!res.ok && res.status !== 206) {
    throw new Error(`${spec.url}: HTTP ${res.status}`);
  }
  if (!part.exists) part.create();

  const writer = part.open(FileMode.Append);
  try {
    const reader = res.body!.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal.aborted) throw new Error('cancelled');
      writer.writeBytes(value);
      hash.update(value);
      onBytes(value.byteLength);
    }
  } finally {
    writer.close();
  }

  const digest = bytesToHex(hash.digest());
  if (digest !== spec.sha256.toLowerCase()) {
    part.delete();
    throw new Error(`${spec.name}: checksum mismatch (expected ${spec.sha256}, got ${digest})`);
  }
  const finalFile = new File(dir, name);
  if (finalFile.exists) finalFile.delete();
  part.moveSync(finalFile);
}

/** Chunk-read an existing .part file into the hash; returns its byte length. */
function seedHashFromPart(part: File, hash: ReturnType<typeof sha256.create>): number {
  const handle = part.open();
  try {
    let total = 0;
    for (;;) {
      const chunk = handle.readBytes(HASH_CHUNK_BYTES);
      if (chunk.byteLength === 0) break;
      hash.update(chunk);
      total += chunk.byteLength;
    }
    return total;
  } finally {
    handle.close();
  }
}
