/**
 * manga-ocr (kha-white) adapter — the Japanese TextRecognizer. ViT encoder (224×224 crop,
 * (v/255 − 0.5)/0.5 normalization) run once per region, then a greedy autoregressive decoder
 * loop over the vocab. The published artifact's `vocab.json` carries the token list AND the
 * special-token ids / maxLen, so tokenizer details live with the artifact, not in code.
 *
 * No KV cache in the standard export — the decoder re-runs over the whole prefix each step
 * (O(n²)). Bubbles are short (< ~40 tokens), so this holds up; if profiling disagrees, a
 * KV-cache re-export changes only this adapter.
 */
import { File } from 'expo-file-system';

import { greedyDecode, type MangaOcrVocab } from './manga-ocr-decode';
import { isPublished, MANGA_OCR } from '../onnx/manifest';
import { isModelInstalled, modelFilePath } from '../onnx/model-store';
import { releaseModel, session } from '../onnx/session-manager';
import { cropToTensor, releaseF32 } from '../onnx/tensors';
import type {
  DetectedRegion,
  EngineAvailability,
  PageImage,
  RecognizedRegion,
  TextRecognizer,
} from '../types';

const INPUT_SIZE = 224;

export type { MangaOcrVocab } from './manga-ocr-decode';

export class MangaOcrEngine implements TextRecognizer {
  readonly capability = {
    id: MANGA_OCR.id,
    kind: 'recognizer' as const,
    displayName: MANGA_OCR.displayName,
    scripts: ['Jpan' as const],
    needsDownload: true,
    downloadBytes: MANGA_OCR.totalBytes,
    priority: 10,
  };

  private vocab: MangaOcrVocab | null = null;

  availability(): Promise<EngineAvailability> {
    if (isModelInstalled(MANGA_OCR)) return Promise.resolve('ready' as const);
    return Promise.resolve(isPublished(MANGA_OCR) ? 'downloadable' : 'unavailable');
  }

  async prepare(): Promise<void> {
    await this.loadVocab();
    await session(MANGA_OCR.id, 'encoder.onnx');
    await session(MANGA_OCR.id, 'decoder.onnx');
  }

  release(): void {
    releaseModel(MANGA_OCR.id);
    this.vocab = null;
  }

  async recognize(
    image: PageImage,
    regions: DetectedRegion[],
    opts: { signal: AbortSignal },
  ): Promise<RecognizedRegion[]> {
    const vocab = await this.loadVocab();
    const encoder = await session(MANGA_OCR.id, 'encoder.onnx');
    const decoder = await session(MANGA_OCR.id, 'decoder.onnx');
    const ort = await import('onnxruntime-react-native');

    const out: RecognizedRegion[] = [];
    for (const region of regions) {
      opts.signal.throwIfAborted();
      const pixels = cropToTensor(image, region.bbox, INPUT_SIZE, INPUT_SIZE);
      let text = '';
      try {
        const pixelTensor = new ort.Tensor('float32', pixels, [1, 3, INPUT_SIZE, INPUT_SIZE]);
        const encoded = await encoder.run({ [encoder.inputNames[0]]: pixelTensor });
        const hidden = encoded[encoder.outputNames[0]];
        text = await greedyDecode(
          decoder,
          hidden,
          vocab,
          ort.Tensor as never,
          opts.signal,
        );
      } finally {
        releaseF32(pixels);
      }
      out.push({ ...region, text, lang: text ? 'ja' : undefined, ocrConfidence: region.confidence });
      // Yield between regions so a page of bubbles doesn't monopolize the JS thread.
      await Promise.resolve();
    }
    return out;
  }

  private async loadVocab(): Promise<MangaOcrVocab> {
    if (this.vocab) return this.vocab;
    const raw = await new File(modelFilePath(MANGA_OCR, 'vocab.json')).text();
    this.vocab = JSON.parse(raw) as MangaOcrVocab;
    return this.vocab;
  }
}
