/**
 * `comical-translator` — the local Expo native module backing the live-translation pipeline
 * (`src/translation/`). It exposes only what JS cannot do itself:
 *
 *   - `decodeImage`: decode + downscale a local image file to a raw RGBA buffer (written to a
 *     temp file — a 2048px page is ~16 MB, which has no business crossing the JS bridge as an
 *     argument; the pipeline reads it back with expo-file-system and deletes it).
 *   - platform OCR: Vision (`VNRecognizeTextRequest`) on iOS, ML Kit Text Recognition v2 on
 *     Android — both the fused full-page tier and per-region recognition on detector output.
 *   - platform translation: Apple Translation framework (iOS 18+) / ML Kit Translation.
 *
 * ONNX inference deliberately does NOT live here — it runs in JS via onnxruntime-react-native,
 * so adding models never touches native code (see src/translation/onnx/).
 *
 * The default export is null when the module isn't linked (web, or before a native build);
 * `src/translation/` degrades to "unsupported" in that case.
 */
import { requireOptionalNativeModule } from 'expo';

/** Axis-aligned rect in original-image pixel coordinates. */
export type NativeRect = { x: number; y: number; w: number; h: number };

/** Quadrilateral (4 corner points, original-image pixels): [[x,y],[x,y],[x,y],[x,y]]. */
export type NativeQuad = number[][];

export type NativeOcrLine = { text: string; quad: NativeQuad };

/** Result of recognizing one requested region (index = position in the request array). */
export type NativeRegionResult = {
  index: number;
  text: string;
  confidence: number;
  lines: NativeOcrLine[];
};

/** One detected+recognized block from a full-page pass. */
export type NativeFullPageBlock = {
  text: string;
  quad: NativeQuad;
  confidence: number;
  /** BCP-47 tag when the OS recognizer reports one, else null. */
  lang: string | null;
};

export type NativeTranslationAvailability = 'ready' | 'downloadable' | 'unsupported';

export interface ComicalTranslatorNative {
  /**
   * Decode a LOCAL image file (file:// or plain path; callers localize remote URIs first),
   * downscaled so max(width, height) <= maxDim, and write the raw RGBA8888 buffer to a temp
   * file. Returns the buffer's dimensions and path (caller owns deleting the file), plus the
   * source file's full pixel dimensions — OCR calls run against the original file, so callers
   * scale rects between the decoded frame and the source frame with these.
   */
  decodeImage(
    uri: string,
    maxDim: number,
  ): Promise<{
    width: number;
    height: number;
    channels: number;
    path: string;
    sourceWidth: number;
    sourceHeight: number;
  }>;

  /** Pixel dimensions of a local image file, without decoding the bitmap. */
  imageSize(uri: string): Promise<{ width: number; height: number }>;

  /**
   * OCR the given regions of a local image. `scripts` are ISO 15924-ish hints
   * ('Latn' | 'Jpan' | 'Kore' | 'Hani') used to pick the recognizer/languages.
   * Line quads come back in ORIGINAL image pixels.
   */
  recognizeInRegions(uri: string, regions: NativeRect[], scripts: string[]): Promise<NativeRegionResult[]>;

  /** Detection + recognition in one native pass (the zero-download tier). */
  recognizeFullPage(uri: string, scripts: string[]): Promise<NativeFullPageBlock[]>;

  /** Whether the OS can translate src->dst (BCP-47), and whether a pack download is needed. */
  translationAvailability(src: string, dst: string): Promise<NativeTranslationAvailability>;

  /** Trigger the OS language-pack download for the pair; resolves true when usable. */
  prepareTranslation(src: string, dst: string): Promise<boolean>;

  /** Translate a batch of strings src->dst. Order-preserving; throws if the pair is unusable. */
  translateBatch(texts: string[], src: string, dst: string): Promise<string[]>;

  /** Android: delete a downloaded ML Kit pack. iOS: no-op (packs are OS-managed), returns false. */
  deleteTranslationPack(src: string, dst: string): Promise<boolean>;

  addListener(eventName: 'onMemoryWarning', listener: () => void): { remove(): void };
}

/** The native module, or null when it isn't linked (web / not-yet-built). */
export default requireOptionalNativeModule<ComicalTranslatorNative>('ComicalTranslator');
