/**
 * comic-text-detector post-processing over synthetic output tensors. Pinned: cxcywh→xyxy
 * conversion, the objectness threshold, logits-vs-probabilities auto-detection (the exported
 * head may or may not bake sigmoid in), and the vertical/horizontal class pick. Fixture
 * tensors from the real published artifact replace the synthetic ones once artifacts ship.
 */
import { describe, expect, test } from 'bun:test';
import { decodeBlocks, OBJECTNESS_THRESHOLD } from './detector-postprocess';

/** Rows of [cx, cy, w, h, obj, clsV, clsH] into a flat tensor. */
function tensor(rows: number[][]): { raw: Float32Array; n: number; c: number } {
  const c = rows[0]?.length ?? 7;
  const raw = new Float32Array(rows.length * c);
  rows.forEach((r, i) => raw.set(r, i * c));
  return { raw, n: rows.length, c };
}

describe('decodeBlocks', () => {
  test('converts center-format to top-left xywh and thresholds objectness', () => {
    const { raw, n, c } = tensor([
      [100, 50, 40, 20, 0.9, 0.8, 0.1],
      [300, 300, 10, 10, OBJECTNESS_THRESHOLD - 0.05, 0.5, 0.5], // below threshold — dropped
    ]);
    const boxes = decodeBlocks(raw, n, c);
    expect(boxes.length).toBe(1);
    expect(boxes[0]).toMatchObject({ x: 80, y: 40, w: 40, h: 20, cls: 0 });
    expect(boxes[0].score).toBeCloseTo(0.9);
  });

  test('classifies horizontal when the second class score wins', () => {
    const { raw, n, c } = tensor([[100, 50, 40, 20, 0.9, 0.2, 0.7]]);
    expect(decodeBlocks(raw, n, c)[0].cls).toBe(1);
  });

  test('applies sigmoid when the head emits logits', () => {
    // obj logit 2.0 → sigmoid ≈ 0.88 (kept); logit -2.0 → ≈ 0.12 (dropped).
    const { raw, n, c } = tensor([
      [100, 50, 40, 20, 2.0, 3.0, -3.0],
      [200, 50, 40, 20, -2.0, 0.0, 0.0],
    ]);
    const boxes = decodeBlocks(raw, n, c);
    expect(boxes.length).toBe(1);
    expect(boxes[0].score).toBeCloseTo(0.88, 1);
    expect(boxes[0].cls).toBe(0);
  });

  test('handles a 5-column head (no class scores) as horizontal', () => {
    const { raw, n, c } = tensor([[100, 50, 40, 20, 0.9]]);
    const boxes = decodeBlocks(raw, n, c);
    expect(boxes.length).toBe(1);
    expect(boxes[0].cls).toBe(0);
  });
});
