/**
 * comic-text-detector (dmMaze) adapter — the manga-first TextDetector. Runs the exported ONNX
 * at 1024×1024 letterboxed input and post-processes the YOLO block head on raw typed arrays
 * (sigmoid → threshold → NMS → un-letterbox). The DBNet lines / mask heads are ignored in v1
 * (the mask is the runway to future text-removal; block boxes are all the overlay needs).
 *
 * Output-tensor layout is pinned against the artifact we publish (fixture tests in
 * __tests__/detector-postprocess.test.ts lock it): [1, N, 4+1+2] — cxcywh in input px,
 * objectness, then {vertical, horizontal} class scores.
 */
import { BBOX_PAD_RATIO, decodeBlocks, NMS_IOU } from './detector-postprocess';
import { COMIC_TEXT_DETECTOR, isPublished } from '../onnx/manifest';
import { isModelInstalled } from '../onnx/model-store';
import { releaseModel, session } from '../onnx/session-manager';
import { letterboxToTensor, nms, releaseF32, unletterboxRect } from '../onnx/tensors';
import type { DetectedRegion, EngineAvailability, PageImage, TextDetector } from '../types';

const INPUT_SIZE = 1024;

export class ComicTextDetectorEngine implements TextDetector {
  readonly capability = {
    id: COMIC_TEXT_DETECTOR.id,
    kind: 'detector' as const,
    displayName: COMIC_TEXT_DETECTOR.displayName,
    scripts: ['Any' as const],
    needsDownload: true,
    downloadBytes: COMIC_TEXT_DETECTOR.totalBytes,
    priority: 10,
  };

  availability(): Promise<EngineAvailability> {
    if (isModelInstalled(COMIC_TEXT_DETECTOR)) return Promise.resolve('ready' as const);
    return Promise.resolve(isPublished(COMIC_TEXT_DETECTOR) ? 'downloadable' : 'unavailable');
  }

  async prepare(): Promise<void> {
    await session(COMIC_TEXT_DETECTOR.id, 'model.onnx');
  }

  release(): void {
    releaseModel(COMIC_TEXT_DETECTOR.id);
  }

  async detect(image: PageImage, opts: { signal: AbortSignal }): Promise<DetectedRegion[]> {
    opts.signal.throwIfAborted();
    const s = await session(COMIC_TEXT_DETECTOR.id, 'model.onnx');
    const { data, box } = letterboxToTensor(image, INPUT_SIZE);
    try {
      opts.signal.throwIfAborted();
      const ort = await import('onnxruntime-react-native');
      const input = new ort.Tensor('float32', data, [1, 3, INPUT_SIZE, INPUT_SIZE]);
      const outputs = await s.run({ [s.inputNames[0]]: input });
      opts.signal.throwIfAborted();

      const blocksOut = outputs['blk'] ?? outputs[s.outputNames[0]];
      const raw = blocksOut.data as Float32Array;
      const [, n, c] = blocksOut.dims as number[];
      const boxes = decodeBlocks(raw, n, c);
      return nms(boxes, NMS_IOU).map((b, id) => {
        const padded = {
          x: b.x - b.w * BBOX_PAD_RATIO,
          y: b.y - b.h * BBOX_PAD_RATIO,
          w: b.w * (1 + 2 * BBOX_PAD_RATIO),
          h: b.h * (1 + 2 * BBOX_PAD_RATIO),
        };
        return {
          id,
          bbox: unletterboxRect(padded, box, image),
          vertical: b.cls === 0,
          confidence: b.score,
        };
      });
    } finally {
      releaseF32(data);
    }
  }
}
