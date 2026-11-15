/**
 * `resolveAssetSource` for pages marked for processing: the bytes are always read here, under
 * either transport, and drawn by the layout the response carries — or shown as they came when it
 * carries none.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test';

mock.module('@/lib/observable', () => ({
  persisted$: () => ({ url: null, get: () => ({ url: null }), peek: () => ({ url: null }), set: () => {} }),
}));
mock.module('@/lib/diagnostics', () => ({ logDiagnostic: () => {} }));
mock.module('@legendapp/state/react', () => ({ use$: (o: unknown) => o }));
let resolvedMode = 'embedded';
mock.module('./embedded/preference', () => ({ getResolvedModeSync: () => resolvedMode }));
const drawn: { bytes: number[]; layout: unknown; copies: unknown; png: boolean }[] = [];
mock.module('./draw-layout', () => ({
  drawLayout: async (bytes: Uint8Array, layout: unknown, copies: unknown, png: boolean) => {
    drawn.push({ bytes: [...bytes], layout, copies, png });
    return 'data:image/jpeg;base64,DRAWN';
  },
}));

const { encodePageLayout, PAGE_LAYOUT_HEADER } = await import('@comical/contract');
const { peekResolvedAssetSource, resolveAssetSource, setTransport } = await import('./api');
const { markProcessed } = await import('./page-process');

const LAYOUT = {
  width: 2,
  height: 1,
  ops: [{ op: 'copy' as const, src: { x: 1, y: 0, w: 1, h: 1 }, dst: { x: 0, y: 0, w: 1, h: 1 } }],
};
const withLayout = () =>
  new Response(Uint8Array.from([1, 2, 3]), { headers: { 'Content-Type': 'image/png', [PAGE_LAYOUT_HEADER]: encodePageLayout(LAYOUT) } });

afterEach(() => {
  drawn.length = 0;
  resolvedMode = 'embedded';
  setTransport(null);
});

describe('processed pages', () => {
  test('embedded: the route answers with a layout and the page is drawn by it', async () => {
    const seen: string[] = [];
    setTransport(async (path) => (seen.push(path), withLayout()));
    const url = markProcessed('/bridges/b/image?url=x&process=%7B%7D');
    expect(await resolveAssetSource(url)).toBe('data:image/jpeg;base64,DRAWN');
    expect(seen).toEqual(['/bridges/b/image?url=x&process=%7B%7D']);
    expect(drawn).toEqual([{ bytes: [1, 2, 3], layout: LAYOUT, copies: [{ sx: 1, sy: 0, sw: 1, sh: 1, dx: 0, dy: 0, dw: 1, dh: 1 }], png: true }]);
  });

  test('remote: a marked page is fetched and drawn, never handed to <Image> as a URL', async () => {
    resolvedMode = 'remote';
    const realFetch = globalThis.fetch;
    const asked: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => (asked.push(String(input)), withLayout())) as typeof fetch;
    try {
      const out = await resolveAssetSource(markProcessed('https://server.example/downloads/entries/b/s/chapters/c/pages/0/file'));
      expect(out).toBe('data:image/jpeg;base64,DRAWN');
      expect(asked).toEqual(['https://server.example/downloads/entries/b/s/chapters/c/pages/0/file']);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test('without a layout header the bytes are shown as they came', async () => {
    setTransport(async () => new Response(Uint8Array.from([9]), { headers: { 'Content-Type': 'image/webp' } }));
    expect(await resolveAssetSource(markProcessed('/bridges/b/image?url=y&process=%7B%7D'))).toBe('data:image/webp;base64,CQ==');
    expect(drawn).toEqual([]);
  });

  test('an unmarked embedded route answering with a layout is drawn too (the downloader resolves raw page URLs)', async () => {
    setTransport(async () => withLayout());
    expect(await resolveAssetSource('/bridges/b/image?url=z&process=%7B%7D')).toBe('data:image/jpeg;base64,DRAWN');
  });

  test('a marked page is never knowable synchronously, absolute URLs included', () => {
    expect(peekResolvedAssetSource(markProcessed('/bridges/b/image?url=q&process=%7B%7D'))).toBeUndefined();
    expect(peekResolvedAssetSource(markProcessed('https://cdn.example/1.webp'))).toBeUndefined();
  });

  test('a failed fetch carries its status', async () => {
    setTransport(async () => new Response('{"error":"nope"}', { status: 502 }));
    const err = await resolveAssetSource(markProcessed('/bridges/b/image?url=e&process=%7B%7D')).catch((e: unknown) => e);
    expect((err as { status?: number }).status).toBe(502);
  });
});
