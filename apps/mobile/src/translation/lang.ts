/**
 * Charset-based language/script detection — the always-ready default LanguageDetector.
 *
 * Comic text is short and noisy, but the scripts themselves are unambiguous: any kana ⇒
 * Japanese, any hangul ⇒ Korean, han without kana ⇒ Chinese. That covers exactly the routing
 * the pipeline needs (which recognizer read this? which translator pair applies?). Latin-script
 * language identification (en vs es vs fr…) is NOT attempted — 'en' is assumed, which only
 * means "don't translate Latin text when the target is English". A smarter detector (ML Kit
 * language ID) can later register as a higher-priority LanguageDetector engine.
 */
import type { Engine, EngineAvailability, Lang, LanguageDetector, Script } from './types';

const KANA = /[぀-ヿㇰ-ㇿ]/; // hiragana + katakana (+ extensions)
const HANGUL = /[가-힯ᄀ-ᇿ㄰-㆏]/;
const HAN = /[一-鿿㐀-䶿豈-﫿]/;
const LATIN = /[a-zA-ZÀ-ɏ]/;

/** Best-effort language of a text snippet, or null when there's nothing to go on. */
export function detectLangOfText(text: string): Lang | null {
  if (KANA.test(text)) return 'ja';
  if (HANGUL.test(text)) return 'ko';
  if (HAN.test(text)) return 'zh'; // han with no kana/hangul anywhere in the snippet
  if (LATIN.test(text)) return 'en';
  return null;
}

/** The script bucket a language's text is (mostly) written in — used for recognizer routing. */
export function scriptForLang(lang: Lang): Script {
  switch (lang.split('-')[0]) {
    case 'ja':
      return 'Jpan';
    case 'ko':
      return 'Kore';
    case 'zh':
      return 'Hani';
    default:
      return 'Latn';
  }
}

/** Scripts worth asking a recognizer for, given the user's source hint ('auto' = all CJK). */
export function scriptsForHint(hint: Script | 'auto'): Script[] {
  return hint === 'auto' ? ['Jpan', 'Kore', 'Hani', 'Latn'] : [hint];
}

class CharsetLanguageDetector implements LanguageDetector {
  readonly capability = {
    id: 'charset-language-detector',
    kind: 'language-detector' as const,
    displayName: 'Character-set detection',
    needsDownload: false,
    priority: 1,
  };

  availability(): Promise<EngineAvailability> {
    return Promise.resolve('ready' as const);
  }

  prepare(): Promise<void> {
    return Promise.resolve();
  }

  release(): void {}

  detectLanguage(texts: string[]): Promise<(Lang | null)[]> {
    return Promise.resolve(texts.map(detectLangOfText));
  }
}

export function createCharsetLanguageDetector(): LanguageDetector & Engine {
  return new CharsetLanguageDetector();
}
