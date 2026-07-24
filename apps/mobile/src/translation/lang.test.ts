/**
 * Charset language detection — the routing floor. Pinned: kana beats han (Japanese text mixes
 * both, so any kana ⇒ ja), hangul ⇒ ko, han-only ⇒ zh, and the Latin fallback ⇒ en.
 */
import { describe, expect, test } from 'bun:test';
import { detectLangOfText, scriptForLang, scriptsForHint } from './lang';

describe('detectLangOfText', () => {
  test('kana wins even in kanji-heavy text', () => {
    expect(detectLangOfText('東京に行きます')).toBe('ja');
    expect(detectLangOfText('カタカナ')).toBe('ja');
  });
  test('hangul is Korean', () => {
    expect(detectLangOfText('안녕하세요!')).toBe('ko');
  });
  test('han without kana is Chinese', () => {
    expect(detectLangOfText('你好，世界')).toBe('zh');
  });
  test('latin falls back to English; symbols-only is null', () => {
    expect(detectLangOfText('Hello there')).toBe('en');
    expect(detectLangOfText('!?…')).toBeNull();
    expect(detectLangOfText('')).toBeNull();
  });
});

describe('script routing helpers', () => {
  test('scriptForLang maps base languages (region subtags ignored)', () => {
    expect(scriptForLang('ja')).toBe('Jpan');
    expect(scriptForLang('ko-KR')).toBe('Kore');
    expect(scriptForLang('zh-Hant')).toBe('Hani');
    expect(scriptForLang('en-US')).toBe('Latn');
  });
  test('scriptsForHint: auto covers all CJK + Latin', () => {
    expect(scriptsForHint('auto')).toEqual(['Jpan', 'Kore', 'Hani', 'Latn']);
    expect(scriptsForHint('Kore')).toEqual(['Kore']);
  });
});
