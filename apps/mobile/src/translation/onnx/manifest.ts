/**
 * Manifests for the downloadable ONNX models. This file is the entire "add a model" surface on
 * the download side: append a manifest here, write one engine adapter in `../engines/`, done —
 * `model-store.ts` (download/verify/delete) and `session-manager.ts` (loading/unloading) are
 * generic over manifests and never change.
 *
 * Artifacts are published as GitHub Release assets on this repo (like the APK/IPA channels),
 * quantized + exported by scripts we keep alongside the release. A manifest whose files lack a
 * sha256 is treated as not-yet-published: it shows in settings but can't be downloaded.
 */

export type OnnxModelFile = {
  /** Filename on disk inside the model's directory. */
  name: string;
  url: string;
  /** Hex sha256 of the file. Empty string = artifact not yet published (download refused). */
  sha256: string;
  bytes: number;
};

export type ExecutionProviderName = 'coreml' | 'nnapi' | 'xnnpack' | 'cpu';

export type OnnxModelManifest = {
  id: string;
  /** Bumped when the artifact changes; part of the on-disk directory name. */
  version: string;
  displayName: string;
  totalBytes: number;
  files: OnnxModelFile[];
  runtime: {
    /** Execution providers to try, in order; 'cpu' is always the implicit last resort. */
    eps: ExecutionProviderName[];
  };
};

const RELEASE_BASE =
  'https://github.com/porksphere/comical-app/releases/download/translator-models-v1';

/**
 * comic-text-detector (dmMaze) — text blocks / lines / mask for manga & comics.
 * exported single-file ONNX, input 1x3x1024x1024.
 */
export const COMIC_TEXT_DETECTOR: OnnxModelManifest = {
  id: 'comic-text-detector',
  version: '1',
  displayName: 'Comic text detector',
  totalBytes: 84_000_000,
  files: [
    {
      name: 'model.onnx',
      url: `${RELEASE_BASE}/comic-text-detector.onnx`,
      sha256: '', // pending first artifact publish
      bytes: 84_000_000,
    },
  ],
  runtime: { eps: ['coreml', 'nnapi', 'xnnpack'] },
};

/**
 * manga-ocr (kha-white) — Japanese manga OCR, ViT encoder + autoregressive decoder,
 * int8-quantized export split into encoder/decoder + vocab.
 *
 * The int8 + 'coreml' pairing below is self-defeating — see review finding 2 in
 * docs/live-translator-feasibility.md. DynamicQuantizeLinear/MatMulInteger aren't in the CoreML
 * EP's op set (onnxruntime#22346), so those subgraphs fall back to CPU, and int8 via MLAS on
 * ARM often isn't faster than fp32 anyway: on an iPhone 12 this trades the ANE for ~340 MB of
 * download. Publish fp16 for iOS/CoreML (encoder ~172 MB) and keep int8 for Android/XNNPACK.
 */
export const MANGA_OCR: OnnxModelManifest = {
  id: 'manga-ocr',
  version: '1',
  displayName: 'Manga OCR (Japanese)',
  totalBytes: 125_000_000,
  files: [
    {
      name: 'encoder.onnx',
      url: `${RELEASE_BASE}/manga-ocr-encoder.int8.onnx`,
      sha256: '', // pending first artifact publish
      bytes: 88_000_000,
    },
    {
      name: 'decoder.onnx',
      url: `${RELEASE_BASE}/manga-ocr-decoder.int8.onnx`,
      sha256: '', // pending first artifact publish
      bytes: 36_000_000,
    },
    {
      name: 'vocab.json',
      url: `${RELEASE_BASE}/manga-ocr-vocab.json`,
      sha256: '', // pending first artifact publish
      bytes: 400_000,
    },
  ],
  runtime: { eps: ['coreml', 'nnapi', 'xnnpack'] },
};

export const MODEL_MANIFESTS: OnnxModelManifest[] = [COMIC_TEXT_DETECTOR, MANGA_OCR];

export function manifestById(id: string): OnnxModelManifest | undefined {
  return MODEL_MANIFESTS.find((m) => m.id === id);
}

/** False while any file's sha256 is unpublished — settings shows the row disabled. */
export function isPublished(manifest: OnnxModelManifest): boolean {
  return manifest.files.every((f) => f.sha256.length === 64);
}
