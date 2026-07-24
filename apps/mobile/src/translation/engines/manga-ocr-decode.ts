/**
 * manga-ocr's greedy autoregressive decode — pure TS, no runtime/RN imports, so the loop's
 * correctness (argmax over the last row, EOS/maxLen stops, wordpiece joining) is unit-testable
 * against a scripted fake session. The adapter in `manga-ocr.ts` feeds it real ORT sessions.
 */

export type MangaOcrVocab = {
  tokens: string[];
  bos: number;
  eos: number;
  pad: number;
  maxLen: number;
};

/** The slice of an ORT InferenceSession the decode loop needs (fakeable in tests). */
export type DecoderSession = {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: unknown; dims: readonly number[] }>>;
};

export type TensorFactory = new (
  type: string,
  data: BigInt64Array | Float32Array,
  dims: number[],
) => unknown;

export type AbortLike = { aborted: boolean; throwIfAborted(): void };

/**
 * Greedy decode. The ids buffer grows in place (one BigInt64Array reused via subarray views) —
 * no per-step allocation beyond the runtime's own output tensors. No KV cache in the standard
 * export, so each step re-runs the whole prefix: O(n²), fine for short bubble text.
 */
export async function greedyDecode(
  decoder: DecoderSession,
  encoderHidden: unknown,
  vocab: MangaOcrVocab,
  Tensor: TensorFactory,
  signal: AbortLike,
): Promise<string> {
  const maxLen = Math.max(2, vocab.maxLen);
  const ids = new BigInt64Array(maxLen);
  ids[0] = BigInt(vocab.bos);
  let length = 1;

  const inputIdsName = decoder.inputNames.find((n) => n.includes('input_ids')) ?? decoder.inputNames[0];
  const hiddenName =
    decoder.inputNames.find((n) => n.includes('encoder_hidden')) ??
    decoder.inputNames[1] ??
    decoder.inputNames[0];

  while (length < maxLen) {
    signal.throwIfAborted();
    const inputIds = new Tensor('int64', ids.subarray(0, length), [1, length]);
    const outputs = await decoder.run({
      [inputIdsName]: inputIds,
      [hiddenName]: encoderHidden,
    });
    const logits = outputs[decoder.outputNames[0]];
    const data = logits.data as Float32Array;
    const [, seq, vocabSize] = logits.dims as number[];
    // Argmax over the LAST position's row only — one pass over vocabSize floats.
    const rowStart = (seq - 1) * vocabSize;
    let best = 0;
    let bestScore = -Infinity;
    for (let v = 0; v < vocabSize; v++) {
      const score = data[rowStart + v];
      if (score > bestScore) {
        bestScore = score;
        best = v;
      }
    }
    ids[length++] = BigInt(best);
    if (best === vocab.eos) break;
  }

  return detokenize(ids, length, vocab);
}

/** Join generated ids into text: drop specials, merge `##` wordpieces. */
export function detokenize(ids: BigInt64Array, length: number, vocab: MangaOcrVocab): string {
  const parts: string[] = [];
  for (let i = 1; i < length; i++) {
    const id = Number(ids[i]);
    if (id === vocab.eos || id === vocab.pad || id === vocab.bos) continue;
    const token = vocab.tokens[id];
    if (token && !token.startsWith('[')) parts.push(token.replace(/^##/, ''));
  }
  return parts.join('');
}
