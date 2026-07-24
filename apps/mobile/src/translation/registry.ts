/**
 * The engine registry — the single routing point between the orchestrator and whatever
 * engines exist. All routing rules live here so an engine addition is registration-only:
 *
 *   - only 'ready' engines are ever picked at pipeline time (downloads are explicit,
 *     from settings or the enable-flow prompt — never silently mid-page);
 *   - among ready candidates, highest `capability.priority` wins;
 *   - the user can pin any stage via translation settings' `engineOverrides` (an override
 *     that isn't ready falls back to normal routing rather than breaking the pipeline).
 */
import { getTranslationSettings } from './settings';
import type {
  Engine,
  EngineAvailability,
  EngineKind,
  Lang,
  LanguageDetector,
  Script,
  TextDetector,
  TextRecognizer,
  Translator,
} from './types';
import { createCharsetLanguageDetector } from './lang';
import { isFusedOcrEngine } from './types';

const AVAILABILITY_TTL_MS = 30_000;

type CachedAvailability = { value: EngineAvailability; at: number };

export class EngineRegistry {
  private engines = new Map<string, Engine>();
  private availabilityCache = new Map<string, CachedAvailability>();
  private fallbackLanguageDetector = createCharsetLanguageDetector();

  register(engine: Engine): void {
    this.engines.set(engine.capability.id, engine);
  }

  /** Engines of a kind (or all), in descending priority — the settings screen's data source. */
  all(kind?: EngineKind): Engine[] {
    const list = [...this.engines.values()].filter((e) => !kind || e.capability.kind === kind);
    return list.sort((a, b) => b.capability.priority - a.capability.priority);
  }

  get(id: string): Engine | undefined {
    return this.engines.get(id);
  }

  /**
   * Detector routing, with the fused fallback rung: when no dedicated detector is ready
   * (ONNX model not downloaded), a fused OCR engine registered as a recognizer serves as the
   * detector — the orchestrator then takes the single-native-pass path.
   */
  async pickDetector(): Promise<TextDetector | null> {
    const dedicated = (await this.pick('detector', () => true)) as TextDetector | null;
    if (dedicated) return dedicated;
    return (await this.pick('recognizer', isFusedOcrEngine)) as TextDetector | null;
  }

  async pickRecognizer(script: Script): Promise<TextRecognizer | null> {
    return (await this.pick('recognizer', (e) => coversScript(e, script))) as TextRecognizer | null;
  }

  async pickTranslator(src: Lang, dst: Lang): Promise<Translator | null> {
    return (await this.pick('translator', (e) => coversPair(e, src, dst))) as Translator | null;
  }

  /** Always returns something — the charset heuristic is registered as the floor. */
  async pickLanguageDetector(): Promise<LanguageDetector> {
    const picked = (await this.pick('language-detector', () => true)) as LanguageDetector | null;
    return picked ?? this.fallbackLanguageDetector;
  }

  /** Availability with a short TTL cache — routing runs per page and must stay cheap. */
  async availabilityOf(engine: Engine): Promise<EngineAvailability> {
    const cached = this.availabilityCache.get(engine.capability.id);
    if (cached && Date.now() - cached.at < AVAILABILITY_TTL_MS) return cached.value;
    let value: EngineAvailability;
    try {
      value = await engine.availability();
    } catch {
      value = 'unavailable';
    }
    this.availabilityCache.set(engine.capability.id, { value, at: Date.now() });
    return value;
  }

  /** Drop cached availability (after a model download/delete) so routing re-evaluates. */
  invalidateAvailability(id?: string): void {
    if (id) this.availabilityCache.delete(id);
    else this.availabilityCache.clear();
  }

  /** Release every engine's runtime resources (memory pressure / reader idle). */
  releaseAll(): void {
    for (const engine of this.engines.values()) engine.release();
  }

  private async pick(kind: EngineKind, fits: (e: Engine) => boolean): Promise<Engine | null> {
    const override = getTranslationSettings().engineOverrides[kind];
    if (override) {
      const engine = this.engines.get(override);
      if (engine && fits(engine) && (await this.availabilityOf(engine)) === 'ready') return engine;
    }
    for (const engine of this.all(kind)) {
      if (!fits(engine)) continue;
      if ((await this.availabilityOf(engine)) === 'ready') return engine;
    }
    return null;
  }
}

function coversScript(engine: Engine, script: Script): boolean {
  const scripts = engine.capability.scripts;
  if (!scripts || scripts.includes('Any')) return true;
  return scripts.includes(script);
}

function coversPair(engine: Engine, src: Lang, dst: Lang): boolean {
  const pairs = engine.capability.langPairs;
  if (!pairs) return true;
  return pairs.some(
    (p) =>
      (p.src === 'any' || p.src === src.split('-')[0]) &&
      (p.dst === 'any' || p.dst === dst.split('-')[0]),
  );
}

export const engineRegistry = new EngineRegistry();
