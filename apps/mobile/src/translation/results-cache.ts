/**
 * Result persistence, two layers with one owner each:
 *
 *   - live UI subscription → the react-query entry `queryKeys.pageTranslation(path, dstLang)`
 *     (its key is in NO_PERSIST_KEYS — results must never ride the whole-cache reserialize);
 *     the query's own queryFn hydrates from the durable layer, the scheduler pushes fresh
 *     results with setQueryData;
 *   - durable → one AsyncStorage entry per result (`comical:translator:result:*`), sharded so
 *     reads stay small, with an index entry for LRU bookkeeping (cap ~400; results are a few
 *     KB of text + rects each).
 *
 * Results are keyed by (raw page path, dstLang) — the raw path is the reader's stable page
 * identity — and self-invalidate via `pipelineVersion`.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { queryClient } from '@/data/query-client';
import { queryKeys } from '@/data/queries';
import { hashString } from './orchestrator';
import { PIPELINE_VERSION, type Lang, type PageTranslation } from './types';

const RESULT_PREFIX = 'comical:translator:result:';
const INDEX_KEY = 'comical:translator:result-index';
const MAX_ENTRIES = 400;

type StoredResult = { pagePath: string; result: PageTranslation };
type IndexEntry = { k: string; at: number };

function resultKey(pagePath: string, dstLang: Lang): string {
  return `${RESULT_PREFIX}${hashString(pagePath)}:${dstLang}`;
}

/** Durable read; null on miss, hash collision, or stale pipeline version. */
export async function readStoredTranslation(
  pagePath: string,
  dstLang: Lang,
): Promise<PageTranslation | null> {
  try {
    const raw = await AsyncStorage.getItem(resultKey(pagePath, dstLang));
    if (!raw) return null;
    const stored = JSON.parse(raw) as StoredResult;
    if (stored.pagePath !== pagePath) return null; // djb2 collision — treat as a miss
    if (stored.result.pipelineVersion !== PIPELINE_VERSION) return null;
    return stored.result;
  } catch {
    return null;
  }
}

/** Write-through: durable entry + LRU index + the live query entry the overlay watches. */
export async function saveTranslation(
  pagePath: string,
  dstLang: Lang,
  result: PageTranslation,
): Promise<void> {
  queryClient.setQueryData(queryKeys.pageTranslation(pagePath, dstLang), result);
  const key = resultKey(pagePath, dstLang);
  try {
    const stored: StoredResult = { pagePath, result };
    await AsyncStorage.setItem(key, JSON.stringify(stored));
    await touchIndex(key);
  } catch {
    // Durable layer is best-effort; the session still has the query-cache copy.
  }
}

export async function clearTranslation(pagePath: string, dstLang: Lang): Promise<void> {
  queryClient.removeQueries({ queryKey: queryKeys.pageTranslation(pagePath, dstLang) });
  try {
    await AsyncStorage.removeItem(resultKey(pagePath, dstLang));
  } catch {
    /* best-effort */
  }
}

/** Fresh result already in memory or on disk? (Scheduler's dedup check.) */
export async function hasTranslation(pagePath: string, dstLang: Lang): Promise<boolean> {
  const live = queryClient.getQueryData<PageTranslation | null>(
    queryKeys.pageTranslation(pagePath, dstLang),
  );
  if (live && live.pipelineVersion === PIPELINE_VERSION) return true;
  return (await readStoredTranslation(pagePath, dstLang)) != null;
}

async function touchIndex(key: string): Promise<void> {
  const raw = await AsyncStorage.getItem(INDEX_KEY);
  let index: IndexEntry[] = [];
  try {
    index = raw ? (JSON.parse(raw) as IndexEntry[]) : [];
  } catch {
    index = [];
  }
  const next = index.filter((e) => e.k !== key);
  next.push({ k: key, at: Date.now() });
  if (next.length > MAX_ENTRIES) {
    next.sort((a, b) => a.at - b.at);
    const evicted = next.splice(0, next.length - MAX_ENTRIES);
    await AsyncStorage.multiRemove(evicted.map((e) => e.k));
  }
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(next));
}
