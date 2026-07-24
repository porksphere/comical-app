/**
 * Platform OCR engine — Vision (iOS) / ML Kit Text Recognition v2 (Android) via the
 * comical-translator native module. It is three things at once:
 *
 *   - the zero-download FUSED tier: `detectAndRecognize` runs detection+recognition in one
 *     native full-page pass when no ONNX detector is installed;
 *   - the recognizer for non-Japanese scripts (KO/ZH/Latin are mostly horizontal — the
 *     platform engines handle them well) on regions found by the ONNX detector;
 *   - the retry rung for regions manga-ocr read as empty/garbage.
 *
 * Regions arrive in the decoded PageImage frame, but the native pass re-reads the ORIGINAL
 * file — rects are scaled out by (source/decoded) and results scaled back.
 */
import translatorNative from '../../../modules/comical-translator';
import type {
  DetectedRegion,
  EngineAvailability,
  FusedOcrEngine,
  PageImage,
  RecognizedRegion,
  Rect,
  Script,
} from '../types';
import { detectLangOfText } from '../lang';

/** Vertical if the box is decidedly taller than wide — platform OCR reports no orientation. */
function looksVertical(bbox: Rect): boolean {
  return bbox.h > bbox.w * 1.5;
}

function quadToRect(quad: number[][]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of quad) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function scaleRect(r: Rect, s: number): Rect {
  return { x: r.x * s, y: r.y * s, w: r.w * s, h: r.h * s };
}

export class PlatformOcrEngine implements FusedOcrEngine {
  readonly capability = {
    id: 'platform-ocr',
    kind: 'recognizer' as const,
    displayName: 'System OCR',
    scripts: ['Jpan', 'Kore', 'Hani', 'Latn'] as Script[],
    needsDownload: false,
    priority: 1,
  };

  availability(): Promise<EngineAvailability> {
    return Promise.resolve(translatorNative ? 'ready' : 'unavailable');
  }

  prepare(): Promise<void> {
    return Promise.resolve();
  }

  release(): void {}

  async detect(image: PageImage, opts: { signal: AbortSignal }): Promise<DetectedRegion[]> {
    const recognized = await this.detectAndRecognize(
      { uri: image.uri },
      ['Jpan', 'Kore', 'Hani', 'Latn'],
      opts,
    );
    // Full-page native results are in source-frame px; rescale into the decoded frame.
    const s = image.width / image.sourceWidth;
    return recognized.map((r) => ({ ...r, bbox: scaleRect(r.bbox, s) }));
  }

  async recognize(
    image: PageImage,
    regions: DetectedRegion[],
    opts: { signal: AbortSignal },
  ): Promise<RecognizedRegion[]> {
    if (!translatorNative) throw new Error('platform OCR unavailable');
    if (regions.length === 0) return [];
    opts.signal.throwIfAborted();
    const toSource = image.sourceWidth / image.width;
    const results = await translatorNative.recognizeInRegions(
      image.uri,
      regions.map((r) => scaleRect(r.bbox, toSource)),
      scriptsOf(regions),
    );
    opts.signal.throwIfAborted();
    return regions.map((region, i) => {
      const match = results.find((r) => r.index === i);
      const text = match?.text?.trim() ?? '';
      return {
        ...region,
        text,
        lang: detectLangOfText(text) ?? undefined,
        ocrConfidence: match?.confidence ?? 0,
      };
    });
  }

  async detectAndRecognize(
    image: { uri: string },
    scripts: Script[],
    opts: { signal: AbortSignal },
  ): Promise<RecognizedRegion[]> {
    if (!translatorNative) throw new Error('platform OCR unavailable');
    opts.signal.throwIfAborted();
    const blocks = await translatorNative.recognizeFullPage(image.uri, scripts);
    opts.signal.throwIfAborted();
    return blocks
      .map((block, i) => {
        const bbox = quadToRect(block.quad);
        const text = block.text.trim();
        return {
          id: i,
          bbox,
          vertical: looksVertical(bbox),
          confidence: block.confidence,
          text,
          lang: block.lang ?? detectLangOfText(text) ?? undefined,
          ocrConfidence: block.confidence,
        };
      })
      .filter((r) => r.text.length > 0 && r.bbox.w > 0 && r.bbox.h > 0);
  }
}

/** The script hints to hand the native recognizer for a batch of regions. */
function scriptsOf(regions: DetectedRegion[]): Script[] {
  // Regions routed here in one group share a script decision upstream; the native side only
  // needs the union hint. Vertical-heavy groups suggest Japanese.
  return regions.some((r) => r.vertical) ? ['Jpan', 'Latn'] : ['Kore', 'Hani', 'Latn'];
}
