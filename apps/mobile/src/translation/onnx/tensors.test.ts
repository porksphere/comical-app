/**
 * The tensor plumbing every ONNX adapter builds on. Pinned here: the letterbox transform must
 * round-trip (a detection in tensor space maps back to the exact source-image rect), crop
 * normalization must match manga-ocr's (v/255 − 0.5)/0.5, and NMS must be class-agnostic with
 * best-score-first survivors.
 */
import { describe, expect, test } from 'bun:test';
import type { PageImage } from '../types';
import {
  acquireF32,
  cropToTensor,
  iou,
  letterboxToTensor,
  nms,
  releaseF32,
  unletterboxRect,
} from './tensors';

function solidImage(width: number, height: number, rgb: [number, number, number]): PageImage {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = rgb[0];
    rgba[i * 4 + 1] = rgb[1];
    rgba[i * 4 + 2] = rgb[2];
    rgba[i * 4 + 3] = 255;
  }
  return { width, height, rgba, uri: 'test://', sourceWidth: width, sourceHeight: height };
}

describe('letterboxToTensor', () => {
  test('wide image: scale by width, pad top/bottom with neutral gray', () => {
    const image = solidImage(200, 100, [255, 0, 0]);
    const { data, box } = letterboxToTensor(image, 64);
    expect(box.scale).toBeCloseTo(64 / 200);
    expect(box.padX).toBe(0);
    expect(box.padY).toBe(16); // (64 - 32) / 2
    const plane = 64 * 64;
    // A padding pixel (row 0) keeps the 0.5 fill on every channel.
    expect(data[0]).toBeCloseTo(0.5);
    // A content pixel (center) is pure red normalized /255.
    const center = 32 * 64 + 32;
    expect(data[center]).toBeCloseTo(1, 1); // R
    expect(data[plane + center]).toBeCloseTo(0, 1); // G
    releaseF32(data);
  });

  test('unletterboxRect round-trips a tensor-space rect to image px', () => {
    const image = solidImage(200, 100, [0, 0, 0]);
    const { data, box } = letterboxToTensor(image, 64);
    releaseF32(data);
    // The full content area in tensor space maps back to the full image.
    const back = unletterboxRect({ x: 0, y: 16, w: 64, h: 32 }, box, image);
    expect(back.x).toBeCloseTo(0);
    expect(back.y).toBeCloseTo(0);
    expect(back.w).toBeCloseTo(200);
    expect(back.h).toBeCloseTo(100);
    // Out-of-content coordinates clamp to the image bounds instead of going negative.
    const clamped = unletterboxRect({ x: -10, y: 0, w: 200, h: 64 }, box, image);
    expect(clamped.x).toBe(0);
    expect(clamped.w).toBeLessThanOrEqual(200);
  });
});

describe('cropToTensor', () => {
  test('applies mean/std 0.5 normalization (white → 1, black → -1)', () => {
    const white = solidImage(20, 20, [255, 255, 255]);
    const data = cropToTensor(white, { x: 0, y: 0, w: 20, h: 20 }, 8, 8);
    expect(data[0]).toBeCloseTo(1);
    releaseF32(data);
    const black = solidImage(20, 20, [0, 0, 0]);
    const data2 = cropToTensor(black, { x: 0, y: 0, w: 20, h: 20 }, 8, 8);
    expect(data2[0]).toBeCloseTo(-1);
    releaseF32(data2);
  });
});

describe('nms', () => {
  test('suppresses overlapping boxes, keeps best-first', () => {
    const kept = nms(
      [
        { x: 0, y: 0, w: 10, h: 10, score: 0.9 },
        { x: 1, y: 1, w: 10, h: 10, score: 0.8 }, // heavy overlap with the first — suppressed
        { x: 100, y: 100, w: 10, h: 10, score: 0.5 }, // disjoint — kept
      ],
      0.35,
    );
    expect(kept.length).toBe(2);
    expect(kept[0].score).toBe(0.9);
    expect(kept[1].score).toBe(0.5);
  });

  test('iou of identical boxes is 1, of disjoint boxes is 0', () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    expect(iou(a, a)).toBeCloseTo(1);
    expect(iou(a, { x: 20, y: 20, w: 5, h: 5 })).toBe(0);
  });
});

describe('buffer pool', () => {
  test('acquire returns a released buffer of the same length', () => {
    const a = acquireF32(128);
    releaseF32(a);
    const b = acquireF32(128);
    expect(b).toBe(a);
    const c = acquireF32(256);
    expect(c).not.toBe(a);
  });
});
