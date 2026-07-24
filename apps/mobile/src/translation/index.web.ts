/**
 * Web stub for the live-translation feature. The pipeline is native-only (platform OCR, OS
 * translators, on-device ONNX); on web every capability reports unsupported and the reader
 * never shows the toggle. This file must not import anything from ./onnx, ./engines,
 * ./orchestrator, or the native module — keeping all of that out of the web bundle is the
 * point. Settings types/hooks stay real so the settings screen renders its "unavailable on
 * web" state with live preference values.
 */
import { type UseQueryOptions } from '@tanstack/react-query';

import { queryKeys } from '@/data/queries';
import type { Lang, PageTranslation } from './types';

export type { EngineKind, Lang, PageTranslation, Script, TranslatedRegion } from './types';
export { useTranslationSettings, setTranslationSettings, getTranslationSettings } from './settings';
export type { PagePipelineState } from './scheduler';
export type { ModelStatus } from './onnx/model-store';

export const translatorNative = null;

export function initTranslation(): void {}

export function isTranslationSupported(): boolean {
  return false;
}

export function ensurePage(): void {}
export function cancelOutsideWindow(): void {}
export function cancelAll(): void {}
export function clearLocalizedPages(): void {}
export async function clearTranslation(): Promise<void> {}

export const MODEL_MANIFESTS: never[] = [];
export function isPublished(): boolean {
  return false;
}
export function isModelDownloading(): boolean {
  return false;
}
export async function downloadModel(): Promise<void> {
  throw new Error('translation models are native-only');
}
export function cancelModelDownload(): void {}
export function deleteModel(): void {}

export const engineRegistry = {
  all: () => [] as never[],
};

export function pageTranslationQuery(
  pagePath: string,
  dstLang: Lang,
): UseQueryOptions<PageTranslation | null, Error> {
  return {
    queryKey: queryKeys.pageTranslation(pagePath, dstLang),
    queryFn: () => null,
    staleTime: Infinity,
  };
}

export function pipelineStateQuery(pageKey: string): UseQueryOptions<{ state: 'idle' }, Error> {
  return {
    queryKey: queryKeys.pageTranslationState(pageKey),
    queryFn: () => ({ state: 'idle' as const }),
    staleTime: Infinity,
  };
}

export function translatorModelsQuery(): UseQueryOptions<never[], Error> {
  return {
    queryKey: queryKeys.translatorModels(),
    queryFn: () => [],
    staleTime: Infinity,
  };
}
