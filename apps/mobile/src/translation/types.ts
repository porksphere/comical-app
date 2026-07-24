/**
 * Core contracts for the live-translation pipeline.
 *
 * The pipeline is four swappable stages — detect text regions → recognize (OCR) → detect
 * language → translate — each behind a small interface implemented by "engines". Engines are
 * registered in `registry.ts` with capability metadata (scripts / language pairs / priority),
 * and the orchestrator composes them per page. Adding a new model (a better JA→EN translator,
 * a Korean-specialized OCR, an LLM) means: write one adapter class implementing the matching
 * interface below (+ an ONNX manifest if it's a downloadable model) and register it — the
 * orchestrator, scheduler, download manager, and native module never change.
 */

/** Writing-script buckets used to route regions to recognizers (ISO 15924-ish). */
export type Script = 'Jpan' | 'Kore' | 'Hani' | 'Latn' | 'Any';

/** BCP-47 language tag ('ja', 'ko', 'zh', 'en', …). */
export type Lang = string;

export type Pt = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

export type EngineAvailability =
  | 'ready' // usable right now
  | 'downloadable' // supported, but a model/pack download is required first
  | 'unavailable'; // can't work on this device/OS (never offered)

export type EngineKind = 'detector' | 'recognizer' | 'translator' | 'language-detector';

export type EngineCapability = {
  id: string;
  kind: EngineKind;
  displayName: string;
  /** Scripts a detector/recognizer covers. */
  scripts?: Script[];
  /** Language pairs a translator covers ('any' = open-ended, e.g. OS translators / LLMs). */
  langPairs?: { src: Lang | 'any'; dst: Lang | 'any' }[];
  needsDownload: boolean;
  /** Rough download size for UI, when needsDownload (0 = OS-managed pack). */
  downloadBytes?: number;
  /** Routing tie-break among 'ready' engines — higher wins. */
  priority: number;
};

export interface Engine {
  readonly capability: EngineCapability;
  /** Cheap and cacheable; called on every routing pass. */
  availability(): Promise<EngineAvailability>;
  /** Download/load whatever the engine needs to become 'ready'. Never called mid-page. */
  prepare(opts?: { signal?: AbortSignal }): Promise<void>;
  /** Drop sessions/handles (memory pressure, model deletion, reader idle). */
  release(): void;
}

/**
 * A decoded page: interleaved RGBA8888, length = width*height*4. Buffers are pooled — never
 * retain one past the pipeline run that handed it to you. `width`/`height` are the DECODED
 * (possibly downscaled) dimensions and define the coordinate frame every region uses;
 * `sourceWidth`/`sourceHeight` are the original file's dimensions, needed only by engines that
 * re-read the file natively (platform OCR) and must scale rects between the two frames.
 */
export type PageImage = {
  width: number;
  height: number;
  rgba: Uint8Array;
  /** Local file the page was decoded from (platform OCR re-reads it natively). */
  uri: string;
  sourceWidth: number;
  sourceHeight: number;
};

export type DetectedRegion = {
  id: number;
  /** Axis-aligned box in ORIGINAL image pixels (the PageImage's frame). */
  bbox: Rect;
  /** Text lines inside the block when the detector provides them (original-image px). */
  lines?: Rect[];
  /** True for vertical text (tategaki) — recognizers may use it, overlays render top-down. */
  vertical: boolean;
  confidence: number;
};

export type RecognizedRegion = DetectedRegion & {
  text: string;
  /** Recognizer-reported language, when it knows (platform OCR sometimes does). */
  lang?: Lang;
  ocrConfidence?: number;
};

export type TranslatedRegion = RecognizedRegion & {
  dstText: string;
  srcLang: Lang;
};

export interface TextDetector extends Engine {
  detect(image: PageImage, opts: { signal: AbortSignal }): Promise<DetectedRegion[]>;
}

export interface TextRecognizer extends Engine {
  recognize(
    image: PageImage,
    regions: DetectedRegion[],
    opts: { signal: AbortSignal },
  ): Promise<RecognizedRegion[]>;
}

export interface Translator extends Engine {
  translate(
    items: { text: string; srcLang: Lang }[],
    dstLang: Lang,
    opts: { signal: AbortSignal },
  ): Promise<string[]>;
}

export interface LanguageDetector extends Engine {
  detectLanguage(texts: string[]): Promise<(Lang | null)[]>;
}

/**
 * Platform OCR does detection+recognition in one native pass over the image file — no RGBA
 * buffer needed. The orchestrator takes this fast path when the routed detector is fused.
 */
export interface FusedOcrEngine extends TextDetector, TextRecognizer {
  detectAndRecognize(
    image: { uri: string },
    scripts: Script[],
    opts: { signal: AbortSignal },
  ): Promise<RecognizedRegion[]>;
}

export function isFusedOcrEngine(engine: Engine): engine is FusedOcrEngine {
  return typeof (engine as FusedOcrEngine).detectAndRecognize === 'function';
}

/**
 * Bump when pre/post-processing or a shipped model version changes in a way that invalidates
 * previously cached results — stale entries are ignored and lazily overwritten.
 */
export const PIPELINE_VERSION = 1;

/** The cached, render-ready outcome of translating one page. */
export type PageTranslation = {
  pipelineVersion: number;
  engineIds: { detector: string; recognizers: string[]; translator: string | null };
  /** The coordinate frame regions are expressed in (the decoded image's pixel size). */
  imageWidth: number;
  imageHeight: number;
  dstLang: Lang;
  regions: TranslatedRegion[];
  /** True when OCR ran but translation couldn't (missing pack) — overlay shows source text. */
  partial?: boolean;
};

export type PipelineStage = 'decode' | 'detect' | 'ocr' | 'translate';
