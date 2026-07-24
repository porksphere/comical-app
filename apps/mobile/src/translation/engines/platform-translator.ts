/**
 * Platform translator engine — Apple Translation framework (iOS 18+) / ML Kit Translation
 * (Android) via the comical-translator native module. Language packs are downloaded by the OS
 * on demand; a missing pack at translate time throws `MissingLanguagePackError`, which the
 * orchestrator turns into a partial (OCR-only) result rather than a failed page.
 */
import { Platform } from 'react-native';

import translatorNative from '../../../modules/comical-translator';
import type { EngineAvailability, Lang, Translator } from '../types';

export class MissingLanguagePackError extends Error {
  constructor(
    readonly src: Lang,
    readonly dst: Lang,
  ) {
    super(`translation pack not downloaded: ${src} -> ${dst}`);
  }
}

export class PlatformTranslatorEngine implements Translator {
  readonly capability = {
    id: 'platform-translator',
    kind: 'translator' as const,
    displayName: Platform.OS === 'ios' ? 'Apple Translation' : 'Google ML Kit',
    langPairs: [{ src: 'any' as const, dst: 'any' as const }],
    needsDownload: false, // packs are OS-managed, surfaced separately in settings
    priority: 1,
  };

  async availability(): Promise<EngineAvailability> {
    if (!translatorNative) return 'unavailable';
    if (Platform.OS === 'ios') {
      // Below iOS 18 the native side reports 'unsupported' for every pair.
      const probe = await translatorNative.translationAvailability('ja', 'en');
      return probe === 'unsupported' ? 'unavailable' : 'ready';
    }
    return 'ready';
  }

  prepare(): Promise<void> {
    return Promise.resolve();
  }

  release(): void {}

  async translate(
    items: { text: string; srcLang: Lang }[],
    dstLang: Lang,
    opts: { signal: AbortSignal },
  ): Promise<string[]> {
    if (!translatorNative) throw new Error('platform translation unavailable');
    if (items.length === 0) return [];
    const src = items[0].srcLang; // orchestrator groups items by source language
    opts.signal.throwIfAborted();
    const availability = await translatorNative.translationAvailability(src, dstLang);
    if (availability !== 'ready') throw new MissingLanguagePackError(src, dstLang);
    opts.signal.throwIfAborted();
    return translatorNative.translateBatch(
      items.map((i) => i.text),
      src,
      dstLang,
    );
  }
}
