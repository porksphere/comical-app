/**
 * comic-text-detector's block-head post-processing — pure TS over the raw output Float32Array,
 * unit-tested with synthetic tensors (and pinned against the published artifact by fixture
 * tests once artifacts exist). Layout assumption for the exported head: [1, N, C] with C ≥ 5 —
 * cxcywh in input px (0..3), objectness (4), then optional {vertical, horizontal} class
 * scores (5, 6).
 */
import { sigmoid, type ScoredBox } from '../onnx/tensors';

export const OBJECTNESS_THRESHOLD = 0.4;
export const NMS_IOU = 0.35;
/** Grow boxes slightly so OCR crops keep the glyphs' edges. */
export const BBOX_PAD_RATIO = 0.08;

/** Decode the [1, N, C] block head into thresholded xywh boxes (still in input px). */
export function decodeBlocks(raw: Float32Array, n: number, c: number): ScoredBox[] {
  const out: ScoredBox[] = [];
  // The exported head may or may not have sigmoid baked in; values outside [0,1] mean logits.
  let needsSigmoid = false;
  for (let i = 0; i < n; i++) {
    const v = raw[i * c + 4];
    if (v < 0 || v > 1) {
      needsSigmoid = true;
      break;
    }
  }
  const act = needsSigmoid ? sigmoid : (v: number) => v;
  for (let i = 0; i < n; i++) {
    const o = i * c;
    const score = act(raw[o + 4]);
    if (score < OBJECTNESS_THRESHOLD) continue;
    const cx = raw[o];
    const cy = raw[o + 1];
    const w = raw[o + 2];
    const h = raw[o + 3];
    let cls = 0;
    if (c >= 7) {
      cls = act(raw[o + 5]) >= act(raw[o + 6]) ? 0 : 1;
    }
    out.push({ x: cx - w / 2, y: cy - h / 2, w, h, score, cls });
  }
  return out;
}
