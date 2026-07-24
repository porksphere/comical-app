/**
 * Public API of the live-translation feature. Screens and reader components import ONLY from
 * here (or `./settings` for the hook); the web bundle resolves `index.web.ts` instead, where
 * every capability reports unsupported and nothing native/ONNX is ever pulled in.
 */
import { type UseQueryOptions } from '@tanstack/react-query';

import { queryKeys } from '@/data/queries';
import translatorNative from '../../modules/comical-translator';
import { registerBuiltInEngines } from './engines';
import { engineRegistry } from './registry';
import { releaseAllSessions } from './onnx/session-manager';
import { pruneModelStore, modelStatuses, type ModelStatus } from './onnx/model-store';
import { readStoredTranslation } from './results-cache';
import type { PagePipelineState } from './scheduler';
import type { Lang, PageTranslation } from './types';

export {
  cancelModelDownload,
  deleteModel,
  downloadModel,
  isModelDownloading,
  type ModelStatus,
} from './onnx/model-store';
export { MODEL_MANIFESTS, isPublished } from './onnx/manifest';
export { engineRegistry } from './registry';
export { cancelAll, cancelOutsideWindow, ensurePage, type PagePipelineState } from './scheduler';
export { clearTranslation } from './results-cache';
export { clearLocalizedPages } from './orchestrator';
export { useTranslationSettings, setTranslationSettings, getTranslationSettings } from './settings';
export type { EngineKind, Lang, PageTranslation, Script, TranslatedRegion } from './types';
export { default as translatorNative } from '../../modules/comical-translator';

let initialized = false;

/** Idempotent feature bootstrap — engine registration, model-dir sweep, memory-pressure hook. */
export function initTranslation(): void {
  if (initialized) return;
  initialized = true;
  registerBuiltInEngines();
  pruneModelStore();
  translatorNative?.addListener('onMemoryWarning', () => {
    releaseAllSessions();
    engineRegistry.releaseAll();
  });
}

/** False on web and before a native build containing the comical-translator module. */
export function isTranslationSupported(): boolean {
  return translatorNative != null;
}

/**
 * The overlay's subscription: hydrates from the durable store, then receives live results
 * pushed by the scheduler via setQueryData. Key is in NO_PERSIST_KEYS — never dehydrated.
 */
export function pageTranslationQuery(
  pagePath: string,
  dstLang: Lang,
): UseQueryOptions<PageTranslation | null, Error> {
  return {
    queryKey: queryKeys.pageTranslation(pagePath, dstLang),
    queryFn: () => readStoredTranslation(pagePath, dstLang),
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000,
  };
}

/** Live pipeline state for a page (translating chip / error chip). Push-only. */
export function pipelineStateQuery(pageKey: string): UseQueryOptions<PagePipelineState, Error> {
  return {
    queryKey: queryKeys.pageTranslationState(pageKey),
    queryFn: () => ({ state: 'idle' as const }),
    staleTime: Infinity,
    gcTime: 5 * 60 * 1000,
  };
}

/** Model download rows for the settings screen. Push-updated during downloads. */
export function translatorModelsQuery(): UseQueryOptions<ModelStatus[], Error> {
  return {
    queryKey: queryKeys.translatorModels(),
    queryFn: () => modelStatuses(),
    staleTime: 30 * 1000,
  };
}
