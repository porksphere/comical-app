/**
 * Per-page pipeline queue. One pipeline at a time (a second concurrent ONNX inference would
 * thrash memory/accelerator), 'current' preempts 'ahead', everything is abortable, and a page
 * with a fresh cached result or an in-flight run is a no-op. The reader drives this from the
 * same effect that powers image prefetch-ahead.
 */
import { queryClient } from '@/data/query-client';
import { queryKeys } from '@/data/queries';
import { translatePage } from './orchestrator';
import { hasTranslation, saveTranslation } from './results-cache';
import { getTranslationSettings } from './settings';
import type { PipelineStage } from './types';

export type PagePipelineState =
  | { state: 'idle' }
  | { state: 'running'; stage: PipelineStage }
  | { state: 'error'; message: string };

type Job = {
  pageKey: string;
  resolvedUri: string;
  priority: 'current' | 'ahead';
  abort: AbortController;
};

const queue: Job[] = [];
let running: Job | null = null;

function stateKey(pageKey: string) {
  return queryKeys.pageTranslationState(pageKey);
}

function setState(pageKey: string, state: PagePipelineState): void {
  queryClient.setQueryData(stateKey(pageKey), state);
}

/** Queue a page for translation (dedup against cache, queue, and the running job). */
export function ensurePage(pageKey: string, resolvedUri: string, priority: 'current' | 'ahead'): void {
  if (running?.pageKey === pageKey) {
    if (priority === 'current') running.priority = 'current';
    return;
  }
  const queued = queue.find((j) => j.pageKey === pageKey);
  if (queued) {
    queued.priority = priority; // promotion moves it to the front of the next pick
    return;
  }
  queue.push({ pageKey, resolvedUri, priority, abort: new AbortController() });
  void pump();
}

/** Abort and drop every queued/running job whose page left the reader's window. */
export function cancelOutsideWindow(keep: Set<string>): void {
  for (let i = queue.length - 1; i >= 0; i--) {
    if (!keep.has(queue[i].pageKey)) {
      setState(queue[i].pageKey, { state: 'idle' });
      queue.splice(i, 1);
    }
  }
  if (running && !keep.has(running.pageKey)) running.abort.abort();
}

/** Reader unmount / feature toggle-off: abort everything. */
export function cancelAll(): void {
  for (const job of queue.splice(0)) setState(job.pageKey, { state: 'idle' });
  running?.abort.abort();
}

async function pump(): Promise<void> {
  if (running) return;
  const next = pickNext();
  if (!next) return;
  running = next;
  const { pageKey, resolvedUri, abort } = next;
  try {
    const dstLang = getTranslationSettings().targetLang;
    if (await hasTranslation(pageKey, dstLang)) {
      setState(pageKey, { state: 'idle' });
      return;
    }
    setState(pageKey, { state: 'running', stage: 'decode' });
    const result = await translatePage(pageKey, resolvedUri, abort.signal, (stage) => {
      setState(pageKey, { state: 'running', stage });
    });
    await saveTranslation(pageKey, dstLang, result);
    setState(pageKey, { state: 'idle' });
  } catch (e) {
    if (abort.signal.aborted) {
      setState(pageKey, { state: 'idle' });
    } else {
      setState(pageKey, { state: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  } finally {
    running = null;
    void pump();
  }
}

function pickNext(): Job | null {
  if (queue.length === 0) return null;
  const currentIdx = queue.findIndex((j) => j.priority === 'current');
  const idx = currentIdx >= 0 ? currentIdx : 0;
  return queue.splice(idx, 1)[0];
}
