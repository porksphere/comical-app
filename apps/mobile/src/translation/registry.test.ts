/**
 * Engine routing. Pinned: only 'ready' engines are picked, higher priority wins, settings
 * `engineOverrides` pin a stage (but an unready override falls back instead of breaking), and
 * the detector rung falls back to a fused OCR engine when no dedicated detector is ready —
 * the contract that makes new-model addition registration-only.
 */
import { describe, expect, mock, test } from 'bun:test';

// registry → settings → lib/observable, which touches react-native's Platform and
// AsyncStorage at module load; neither exists under bun.
const mem = new Map<string, string>();
mock.module('react-native', () => ({ Platform: { OS: 'ios' } }));
mock.module('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => mem.get(k) ?? null,
    setItem: async (k: string, v: string) => void mem.set(k, v),
    removeItem: async (k: string) => void mem.delete(k),
    getAllKeys: async () => [...mem.keys()],
    multiGet: async (keys: string[]) => keys.map((k) => [k, mem.get(k) ?? null]),
    multiSet: async (kvs: [string, string][]) => kvs.forEach(([k, v]) => mem.set(k, v)),
    multiRemove: async (keys: string[]) => keys.forEach((k) => mem.delete(k)),
  },
}));

const { EngineRegistry } = await import('./registry');
const { setTranslationSettings } = await import('./settings');
const { isFusedOcrEngine } = await import('./types');
type Engine = import('./types').Engine;

function fakeEngine(
  over: Partial<import('./types').EngineCapability> & { id: string; kind: import('./types').EngineKind },
  availability: import('./types').EngineAvailability = 'ready',
  fused = false,
): Engine {
  const engine: Record<string, unknown> = {
    capability: { displayName: over.id, needsDownload: false, priority: 1, ...over },
    availability: async () => availability,
    prepare: async () => {},
    release: () => {},
  };
  if (over.kind === 'detector' || fused) engine.detect = async () => [];
  if (over.kind === 'recognizer') engine.recognize = async () => [];
  if (fused) engine.detectAndRecognize = async () => [];
  if (over.kind === 'translator') engine.translate = async () => [];
  return engine as unknown as Engine;
}

describe('engineRegistry routing', () => {
  test('higher priority ready engine wins; unready engines are skipped', async () => {
    const registry = new EngineRegistry();
    registry.register(fakeEngine({ id: 'det-lo', kind: 'detector', priority: 1 }));
    registry.register(fakeEngine({ id: 'det-hi', kind: 'detector', priority: 10 }, 'downloadable'));
    const picked = await registry.pickDetector();
    expect(picked?.capability.id).toBe('det-lo'); // hi-priority engine isn't downloaded → skipped
  });

  test('recognizer routing respects script coverage', async () => {
    const registry = new EngineRegistry();
    registry.register(fakeEngine({ id: 'jpan-only', kind: 'recognizer', priority: 10, scripts: ['Jpan'] }));
    registry.register(
      fakeEngine({ id: 'all-scripts', kind: 'recognizer', priority: 1, scripts: ['Jpan', 'Kore', 'Latn'] }),
    );
    expect((await registry.pickRecognizer('Jpan'))?.capability.id).toBe('jpan-only');
    expect((await registry.pickRecognizer('Kore'))?.capability.id).toBe('all-scripts');
  });

  test('fused recognizer serves as detector when no dedicated detector is ready', async () => {
    const registry = new EngineRegistry();
    registry.register(fakeEngine({ id: 'onnx-detector', kind: 'detector', priority: 10 }, 'downloadable'));
    registry.register(
      fakeEngine({ id: 'platform-ocr', kind: 'recognizer', priority: 1, scripts: ['Jpan', 'Latn'] }, 'ready', true),
    );
    const picked = await registry.pickDetector();
    expect(picked?.capability.id).toBe('platform-ocr');
    expect(picked && isFusedOcrEngine(picked)).toBe(true);
  });

  test('non-fused recognizers never serve as detectors', async () => {
    const registry = new EngineRegistry();
    registry.register(fakeEngine({ id: 'plain-recognizer', kind: 'recognizer', priority: 1 }));
    expect(await registry.pickDetector()).toBeNull();
  });

  test('translator routing matches language pairs, any-pair engines cover everything', async () => {
    const registry = new EngineRegistry();
    registry.register(
      fakeEngine({ id: 'ja-en-specialist', kind: 'translator', priority: 20, langPairs: [{ src: 'ja', dst: 'en' }] }),
    );
    registry.register(
      fakeEngine({ id: 'os-translator', kind: 'translator', priority: 1, langPairs: [{ src: 'any', dst: 'any' }] }),
    );
    expect((await registry.pickTranslator('ja', 'en'))?.capability.id).toBe('ja-en-specialist');
    expect((await registry.pickTranslator('ko', 'en'))?.capability.id).toBe('os-translator');
    // Region subtags reduce to the base language for pair matching.
    expect((await registry.pickTranslator('ja', 'en-US'))?.capability.id).toBe('ja-en-specialist');
  });

  test('engineOverrides pin a stage; an unready override falls back to routing', async () => {
    const registry = new EngineRegistry();
    registry.register(
      fakeEngine({ id: 'ja-en-specialist', kind: 'translator', priority: 20, langPairs: [{ src: 'ja', dst: 'en' }] }),
    );
    registry.register(
      fakeEngine({ id: 'os-translator', kind: 'translator', priority: 1, langPairs: [{ src: 'any', dst: 'any' }] }),
    );
    setTranslationSettings({ engineOverrides: { translator: 'os-translator' } });
    expect((await registry.pickTranslator('ja', 'en'))?.capability.id).toBe('os-translator');

    setTranslationSettings({ engineOverrides: { translator: 'not-registered' } });
    expect((await registry.pickTranslator('ja', 'en'))?.capability.id).toBe('ja-en-specialist');
    setTranslationSettings({ engineOverrides: {} });
  });

  test('language detector always resolves (charset floor)', async () => {
    const registry = new EngineRegistry();
    const detector = await registry.pickLanguageDetector();
    expect(await detector.detectLanguage(['こんにちは'])).toEqual(['ja']);
  });
});
