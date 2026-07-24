/**
 * Tensor plumbing shared by the ONNX engine adapters: a byte-length-keyed buffer pool (a page
 * pipeline allocates the same handful of shapes over and over — pooling keeps Hermes GC quiet),
 * RGBA→NCHW preprocessing (letterbox / crop+resize with bilinear sampling), and NMS. All pure
 * TS over typed arrays, unit-tested in isolation.
 */
import type { PageImage, Rect } from '../types';

const pool = new Map<number, Float32Array[]>();

/** A pooled Float32Array of exactly `length`. Contents are undefined — callers overwrite. */
export function acquireF32(length: number): Float32Array {
  const bucket = pool.get(length);
  const buf = bucket?.pop();
  return buf ?? new Float32Array(length);
}

export function releaseF32(buf: Float32Array): void {
  const bucket = pool.get(buf.length) ?? [];
  if (bucket.length < 4) {
    // cap per-shape retention; anything beyond is realloc-on-demand
    bucket.push(buf);
    pool.set(buf.length, bucket);
  }
}

/** Drop every pooled buffer (memory-pressure path). */
export function drainPool(): void {
  pool.clear();
}

export type Letterbox = { scale: number; padX: number; padY: number };

/**
 * Letterbox `image` into a `size`x`size` NCHW float tensor (RGB, values 0..1, gray padding),
 * bilinear-sampled. Returns the tensor data (pooled — release when done) and the transform
 * needed to map detections back to original-image pixels.
 */
export function letterboxToTensor(
  image: PageImage,
  size: number,
): { data: Float32Array; box: Letterbox } {
  const scale = Math.min(size / image.width, size / image.height);
  const outW = Math.max(1, Math.round(image.width * scale));
  const outH = Math.max(1, Math.round(image.height * scale));
  const padX = Math.floor((size - outW) / 2);
  const padY = Math.floor((size - outH) / 2);

  const data = acquireF32(3 * size * size);
  data.fill(0.5); // neutral gray padding, matches the detector's training-time letterbox
  samplePlanes(image, { x: 0, y: 0, w: image.width, h: image.height }, data, size, size, {
    dstX: padX,
    dstY: padY,
    dstW: outW,
    dstH: outH,
    normalize: (v) => v / 255,
  });
  return { data, box: { scale, padX, padY } };
}

/** Map a rect in letterboxed-tensor coordinates back to original-image pixels. */
export function unletterboxRect(r: Rect, box: Letterbox, image: { width: number; height: number }): Rect {
  const x = clamp((r.x - box.padX) / box.scale, 0, image.width);
  const y = clamp((r.y - box.padY) / box.scale, 0, image.height);
  const x2 = clamp((r.x + r.w - box.padX) / box.scale, 0, image.width);
  const y2 = clamp((r.y + r.h - box.padY) / box.scale, 0, image.height);
  return { x, y, w: Math.max(0, x2 - x), h: Math.max(0, y2 - y) };
}

/**
 * Crop `rect` out of `image` and resize to `w`x`h` as an NCHW float tensor with
 * `(v/255 - mean) / std` normalization (manga-ocr uses mean=std=0.5). Pooled — release after
 * the encoder run.
 */
export function cropToTensor(
  image: PageImage,
  rect: Rect,
  w: number,
  h: number,
  mean = 0.5,
  std = 0.5,
): Float32Array {
  const data = acquireF32(3 * w * h);
  samplePlanes(image, rect, data, w, h, {
    dstX: 0,
    dstY: 0,
    dstW: w,
    dstH: h,
    normalize: (v) => (v / 255 - mean) / std,
  });
  return data;
}

type SampleTarget = {
  dstX: number;
  dstY: number;
  dstW: number;
  dstH: number;
  normalize: (v: number) => number;
};

/** Bilinear-sample an image rect into the RGB planes of an NCHW tensor region. */
function samplePlanes(
  image: PageImage,
  src: Rect,
  out: Float32Array,
  outW: number,
  outH: number,
  t: SampleTarget,
): void {
  const { rgba, width, height } = image;
  const planeSize = outW * outH;
  const srcX = clamp(src.x, 0, width);
  const srcY = clamp(src.y, 0, height);
  const srcW = Math.max(1, Math.min(src.w, width - srcX));
  const srcH = Math.max(1, Math.min(src.h, height - srcY));
  const xRatio = srcW / t.dstW;
  const yRatio = srcH / t.dstH;

  for (let dy = 0; dy < t.dstH; dy++) {
    const sy = Math.min(srcY + (dy + 0.5) * yRatio - 0.5, height - 1);
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(height - 1, y0 + 1);
    const fy = sy - y0;
    const rowOut = (t.dstY + dy) * outW;
    for (let dx = 0; dx < t.dstW; dx++) {
      const sx = Math.min(srcX + (dx + 0.5) * xRatio - 0.5, width - 1);
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(width - 1, x0 + 1);
      const fx = sx - x0;
      const i00 = (y0 * width + x0) * 4;
      const i01 = (y0 * width + x1) * 4;
      const i10 = (y1 * width + x0) * 4;
      const i11 = (y1 * width + x1) * 4;
      const o = rowOut + t.dstX + dx;
      for (let c = 0; c < 3; c++) {
        const top = rgba[i00 + c] * (1 - fx) + rgba[i01 + c] * fx;
        const bottom = rgba[i10 + c] * (1 - fx) + rgba[i11 + c] * fx;
        out[c * planeSize + o] = t.normalize(top * (1 - fy) + bottom * fy);
      }
    }
  }
}

export type ScoredBox = Rect & { score: number; cls?: number };

/** Class-agnostic non-maximum suppression over xywh boxes; returns survivors, best first. */
export function nms(boxes: ScoredBox[], iouThreshold: number): ScoredBox[] {
  const sorted = [...boxes].sort((a, b) => b.score - a.score);
  const kept: ScoredBox[] = [];
  for (const box of sorted) {
    if (kept.every((k) => iou(k, box) < iouThreshold)) kept.push(box);
  }
  return kept;
}

export function iou(a: Rect, b: Rect): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union <= 0 ? 0 : inter / union;
}

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
