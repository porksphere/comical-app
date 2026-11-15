import { describe, expect, test } from 'bun:test';

import { isProcessed, layoutCopies, markProcessed, unmarked } from './page-process';

describe('the processed mark', () => {
  test('rides any URL shape and comes off cleanly', () => {
    for (const url of ['https://cdn.example/1.webp', '/bridges/b/image?url=x&process=%7B%7D', 'https://x/1.jpg#keep']) {
      const marked = markProcessed(url);
      expect(isProcessed(marked)).toBe(true);
      expect(unmarked(marked)).toBe(url);
      expect(markProcessed(marked)).toBe(marked);
    }
  });

  test('an unmarked URL, or one whose fragment merely mentions it, is not processed', () => {
    expect(isProcessed('https://x/1.jpg')).toBe(false);
    expect(isProcessed('https://x/1.jpg#comical-processed')).toBe(false);
    expect(unmarked('https://x/1.jpg#page=2')).toBe('https://x/1.jpg#page=2');
  });
});

describe('layoutCopies', () => {
  test('copy operations become draw rectangles, in order', () => {
    expect(
      layoutCopies({
        width: 20,
        height: 10,
        ops: [{ op: 'copy', src: { x: 10, y: 0, w: 10, h: 10 }, dst: { x: 0, y: 0, w: 10, h: 10 } }],
      }),
    ).toEqual([{ sx: 10, sy: 0, sw: 10, sh: 10, dx: 0, dy: 0, dw: 10, dh: 10 }]);
  });

  test('an operation this client does not know means the page is shown as it came', () => {
    const future = { width: 10, height: 10, ops: [{ op: 'rotate', degrees: 90 }] } as never;
    expect(layoutCopies(future)).toBeUndefined();
  });
});
