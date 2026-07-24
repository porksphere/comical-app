/**
 * Composes registry-picked engines into one page run:
 *
 *   localize → decode → detect → recognize (per-script routing + retry ladder)
 *            → language-detect → translate (grouped by source language) → PageTranslation
 *
 * Two paths share that shape: the FUSED path (platform OCR is the routed detector — one native
 * pass over the file, no RGBA decode at all) and the ONNX path (comic-text-detector regions,
 * recognizers routed per script). The orchestrator holds no model specifics — engines are
 * opaque behind their stage interfaces, which is what keeps new models registration-only.
 */
import { Image } from 'expo-image';
import { Directory, File, Paths } from 'expo-file-system';

import translatorNative from '../../modules/comical-translator';
import { scriptsForHint } from './lang';
import { engineRegistry } from './registry';
import { getTranslationSettings } from './settings';
import { MissingLanguagePackError } from './engines/platform-translator';
import {
  isFusedOcrEngine,
  PIPELINE_VERSION,
  type Lang,
  type PageImage,
  type PageTranslation,
  type PipelineStage,
  type RecognizedRegion,
  type Script,
  type TranslatedRegion,
} from './types';

/** Detector input tops out at 1024px, OCR crops want headroom above that. */
const DECODE_MAX_DIM = 2048;
/** Recognized text shorter than this (after trimming) is treated as an OCR miss. */
const MIN_TEXT_LENGTH = 1;

export async function translatePage(
  rawPagePath: string,
  resolvedUri: string,
  signal: AbortSignal,
  onStage?: (stage: PipelineStage) => void,
): Promise<PageTranslation> {
  const settings = getTranslationSettings();
  const dstLang = settings.targetLang;
  const detector = await engineRegistry.pickDetector();
  if (!detector) throw new Error('no OCR engine available on this device');

  onStage?.('decode');
  const localUri = await ensureLocalFile(resolvedUri, signal);

  // ── fused path: one native pass, no RGBA decode ─────────────────────────────────────────────
  if (isFusedOcrEngine(detector)) {
    if (!translatorNative) throw new Error('translation requires the native module');
    const { width, height } = await translatorNative.imageSize(localUri);
    onStage?.('detect');
    const recognized = await detector.detectAndRecognize(
      { uri: localUri },
      scriptsForHint(settings.sourceScriptHint),
      { signal },
    );
    onStage?.('translate');
    const { regions, translatorId, partial } = await translateRegions(recognized, dstLang, signal);
    return {
      pipelineVersion: PIPELINE_VERSION,
      engineIds: {
        detector: detector.capability.id,
        recognizers: [detector.capability.id],
        translator: translatorId,
      },
      imageWidth: width,
      imageHeight: height,
      dstLang,
      regions,
      partial,
    };
  }

  // ── ONNX path: decode once, detect, route regions to recognizers ───────────────────────────
  const image = await decodePage(localUri, signal);
  try {
    onStage?.('detect');
    const detected = await detector.detect(image, { signal });

    onStage?.('ocr');
    const recognizerIds = new Set<string>();
    let recognized: RecognizedRegion[] = [];
    if (detected.length > 0) {
      const primaryScript = primaryScriptFor(settings.sourceScriptHint);
      const primary = await engineRegistry.pickRecognizer(primaryScript);
      if (!primary) throw new Error('no recognizer available');
      recognizerIds.add(primary.capability.id);
      recognized = await primary.recognize(image, detected, { signal });

      // Retry ladder: regions the primary read as empty get one shot on the other recognizer.
      const misses = recognized.filter((r) => r.text.trim().length < MIN_TEXT_LENGTH);
      if (misses.length > 0) {
        const fallback = await engineRegistry.pickRecognizer('Latn');
        if (fallback && fallback.capability.id !== primary.capability.id) {
          recognizerIds.add(fallback.capability.id);
          const retried = await fallback.recognize(image, misses, { signal });
          const byId = new Map(retried.map((r) => [r.id, r]));
          recognized = recognized.map((r) => {
            const retry = byId.get(r.id);
            return retry && retry.text.trim().length >= MIN_TEXT_LENGTH ? retry : r;
          });
        }
      }
    }

    onStage?.('translate');
    const { regions, translatorId, partial } = await translateRegions(recognized, dstLang, signal);
    return {
      pipelineVersion: PIPELINE_VERSION,
      engineIds: {
        detector: detector.capability.id,
        recognizers: [...recognizerIds],
        translator: translatorId,
      },
      imageWidth: image.width,
      imageHeight: image.height,
      dstLang,
      regions,
      partial,
    };
  } finally {
    // The decoded buffer is scratch; PageImage buffers must never outlive the run.
    image.rgba = new Uint8Array(0);
  }
}

/** Language-detect, drop already-target-language regions, translate grouped by source lang. */
async function translateRegions(
  recognized: RecognizedRegion[],
  dstLang: Lang,
  signal: AbortSignal,
): Promise<{ regions: TranslatedRegion[]; translatorId: string | null; partial: boolean }> {
  const withText = recognized.filter((r) => r.text.trim().length >= MIN_TEXT_LENGTH);
  if (withText.length === 0) return { regions: [], translatorId: null, partial: false };

  const langDetector = await engineRegistry.pickLanguageDetector();
  const langs = await langDetector.detectLanguage(withText.map((r) => r.text));
  const dstBase = dstLang.split('-')[0];
  const toTranslate = withText
    .map((r, i) => ({ region: r, srcLang: r.lang ?? langs[i] ?? 'und' }))
    .filter((r) => r.srcLang !== 'und' && r.srcLang.split('-')[0] !== dstBase);
  if (toTranslate.length === 0) return { regions: [], translatorId: null, partial: false };

  const bySrc = new Map<string, typeof toTranslate>();
  for (const item of toTranslate) {
    const list = bySrc.get(item.srcLang) ?? [];
    list.push(item);
    bySrc.set(item.srcLang, list);
  }

  const out: TranslatedRegion[] = [];
  let translatorId: string | null = null;
  let partial = false;
  for (const [srcLang, items] of bySrc) {
    signal.throwIfAborted();
    const translator = await engineRegistry.pickTranslator(srcLang, dstLang);
    if (!translator) {
      partial = true;
      out.push(...items.map((i) => ({ ...i.region, srcLang, dstText: i.region.text })));
      continue;
    }
    translatorId = translator.capability.id;
    try {
      const translated = await translator.translate(
        items.map((i) => ({ text: i.region.text, srcLang })),
        dstLang,
        { signal },
      );
      items.forEach((item, i) => {
        out.push({ ...item.region, srcLang, dstText: translated[i] ?? item.region.text });
      });
    } catch (e) {
      if (e instanceof MissingLanguagePackError) {
        // OCR still succeeded — surface the source text and let the UI offer the pack download.
        partial = true;
        out.push(...items.map((i) => ({ ...i.region, srcLang, dstText: i.region.text })));
      } else {
        throw e;
      }
    }
  }
  out.sort((a, b) => a.id - b.id);
  return { regions: out, translatorId, partial };
}

/** The script whose recognizer leads the ladder. 'auto' leads with Japanese (manga-first). */
function primaryScriptFor(hint: Script | 'auto'): Script {
  return hint === 'auto' ? 'Jpan' : hint;
}

/** Decode through the native module into a PageImage (temp RGBA file read + deleted here). */
async function decodePage(localUri: string, signal: AbortSignal): Promise<PageImage> {
  if (!translatorNative) throw new Error('translation requires the native module');
  signal.throwIfAborted();
  const decoded = await translatorNative.decodeImage(localUri, DECODE_MAX_DIM);
  const file = new File(decoded.path);
  try {
    const rgba = await file.bytes();
    return {
      width: decoded.width,
      height: decoded.height,
      rgba,
      uri: localUri,
      sourceWidth: decoded.sourceWidth,
      sourceHeight: decoded.sourceHeight,
    };
  } finally {
    try {
      file.delete();
    } catch {
      /* temp file; the OS cache dir reclaims stragglers */
    }
  }
}

const LOCALIZE_DIR = 'translator-pages';

/**
 * The native pipeline needs a local file. Reader pages usually sit in expo-image's disk cache
 * already; otherwise fetch the bytes once into our own scratch dir (cache storage — safe to
 * reclaim, and swept when the reader closes via `clearLocalizedPages`).
 */
async function ensureLocalFile(resolvedUri: string, signal: AbortSignal): Promise<string> {
  if (resolvedUri.startsWith('file://') || resolvedUri.startsWith('/')) return resolvedUri;
  const cached = await Image.getCachePathAsync(resolvedUri);
  if (cached) return cached;
  signal.throwIfAborted();
  const res = await fetch(resolvedUri, { signal });
  if (!res.ok) throw new Error(`page fetch failed: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const dir = new Directory(Paths.cache, LOCALIZE_DIR);
  if (!dir.exists) dir.create({ intermediates: true });
  const file = new File(dir, `${hashString(resolvedUri)}.img`);
  file.write(bytes);
  return file.uri;
}

export function clearLocalizedPages(): void {
  try {
    const dir = new Directory(Paths.cache, LOCALIZE_DIR);
    if (dir.exists) dir.delete();
  } catch {
    /* best-effort */
  }
}

/** djb2 — stable, fast, good enough for filenames/cache keys (not security). */
export function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}
