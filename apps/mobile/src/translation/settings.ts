/**
 * Translation preferences — device-local state, so a Legend State persisted store
 * (see AGENTS.md "State" and `lib/observable.ts`). The reader's on/off switch is NOT here:
 * `liveTranslate` lives in reader settings (`hooks/use-reader-settings.ts`) with the other
 * per-reader toggles; this store owns everything else about how the pipeline behaves.
 */
import { use$ } from '@legendapp/state/react';

import { persisted$ } from '@/lib/observable';
import type { EngineKind, Lang, Script } from './types';

export type TranslationSettings = {
  /** Target language for translations (BCP-47). */
  targetLang: Lang;
  /** How many upcoming pages to translate ahead of the reader (0 = only the current page). */
  translateAhead: number;
  /** Which script the source content is in — 'auto' tries CJK detection per region. */
  sourceScriptHint: Script | 'auto';
  /** Per-stage engine pins from the advanced settings row; empty = automatic routing. */
  engineOverrides: Partial<Record<EngineKind, string>>;
};

export const DEFAULT_TRANSLATION_SETTINGS: TranslationSettings = {
  targetLang: 'en',
  translateAhead: 1,
  sourceScriptHint: 'auto',
  engineOverrides: {},
};

const settings$ = persisted$<TranslationSettings>(
  'comical:translationSettings',
  DEFAULT_TRANSLATION_SETTINGS,
);

export function getTranslationSettings(): TranslationSettings {
  return { ...DEFAULT_TRANSLATION_SETTINGS, ...settings$.peek() };
}

export function setTranslationSettings(patch: Partial<TranslationSettings>): void {
  settings$.assign(patch);
}

/** Spread over defaults so persisted blobs from older builds still surface new fields. */
export function useTranslationSettings(): [
  TranslationSettings,
  (patch: Partial<TranslationSettings>) => void,
] {
  const value = use$(settings$);
  return [{ ...DEFAULT_TRANSLATION_SETTINGS, ...value }, setTranslationSettings];
}
