/**
 * The greedy decode loop against a scripted fake decoder: token selection is argmax over the
 * LAST sequence position only, generation stops on EOS or maxLen, and detokenization strips
 * specials and joins `##` wordpieces. A regression here silently produces garbage OCR, so the
 * loop is pinned independently of the real ONNX sessions.
 */
import { describe, expect, test } from 'bun:test';
import { detokenize, greedyDecode, type DecoderSession, type MangaOcrVocab } from './manga-ocr-decode';

const VOCAB: MangaOcrVocab = {
  tokens: ['[PAD]', '[UNK]', '[CLS]', '[SEP]', 'こん', '##にちは', 'テスト'],
  bos: 2,
  eos: 3,
  pad: 0,
  maxLen: 8,
};

class FakeTensor {
  constructor(
    readonly type: string,
    readonly data: BigInt64Array | Float32Array,
    readonly dims: number[],
  ) {}
}

const signal = { aborted: false, throwIfAborted() {} };

/** A decoder that emits `script` one token per step (logits favor script[step]). */
function scriptedDecoder(script: number[]): DecoderSession & { calls: number[][] } {
  const calls: number[][] = [];
  return {
    calls,
    inputNames: ['input_ids', 'encoder_hidden_states'],
    outputNames: ['logits'],
    async run(feeds) {
      const ids = (feeds['input_ids'] as FakeTensor).data as BigInt64Array;
      calls.push([...ids].map(Number));
      const step = ids.length - 1;
      const seq = ids.length;
      const vocabSize = VOCAB.tokens.length;
      const logits = new Float32Array(seq * vocabSize);
      // Fill earlier rows with a decoy max so an argmax over the wrong row is caught.
      for (let r = 0; r < seq - 1; r++) logits[r * vocabSize + 1] = 99;
      logits[(seq - 1) * vocabSize + script[Math.min(step, script.length - 1)]] = 10;
      return { logits: { data: logits, dims: [1, seq, vocabSize] } };
    },
  };
}

describe('greedyDecode', () => {
  test('decodes scripted tokens until EOS and joins wordpieces', async () => {
    const decoder = scriptedDecoder([4, 5, 3]); // こん ##にちは [SEP]
    const text = await greedyDecode(decoder, {}, VOCAB, FakeTensor as never, signal);
    expect(text).toBe('こんにちは');
    // Each step fed the full prefix (no KV cache): lengths 1, 2, 3.
    expect(decoder.calls.map((c) => c.length)).toEqual([1, 2, 3]);
    expect(decoder.calls[0]).toEqual([VOCAB.bos]);
  });

  test('stops at maxLen when EOS never comes', async () => {
    const decoder = scriptedDecoder([6, 6, 6, 6, 6, 6, 6, 6, 6, 6]);
    const text = await greedyDecode(decoder, {}, VOCAB, FakeTensor as never, signal);
    // maxLen 8 = BOS + 7 generated tokens.
    expect(text).toBe('テスト'.repeat(7));
  });

  test('aborts between steps', async () => {
    const decoder = scriptedDecoder([6, 6, 6]);
    const aborting = {
      aborted: false,
      calls: 0,
      throwIfAborted() {
        if (this.calls++ >= 2) throw new Error('aborted');
      },
    };
    await expect(greedyDecode(decoder, {}, VOCAB, FakeTensor as never, aborting)).rejects.toThrow('aborted');
  });
});

describe('detokenize', () => {
  test('drops specials and bracketed tokens', () => {
    const ids = new BigInt64Array([2n, 4n, 0n, 1n, 5n, 3n]);
    // [CLS] こん [PAD] [UNK] ##にちは [SEP] → こんにちは ([UNK] is bracketed → dropped)
    expect(detokenize(ids, ids.length, VOCAB)).toBe('こんにちは');
  });
});
