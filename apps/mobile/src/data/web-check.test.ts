import { afterEach, describe, expect, mock, test } from 'bun:test';

mock.module('@/lib/observable', () => ({
  persisted$: () => ({ url: null, get: () => ({ url: null }), peek: () => ({ url: null }), set: () => {} }),
}));
mock.module('@/lib/diagnostics', () => ({ logDiagnostic: () => {} }));
mock.module('@legendapp/state/react', () => ({ use$: (o: unknown) => o }));
mock.module('./embedded/preference', () => ({ getResolvedModeSync: () => 'remote' }));
mock.module('./request-monitor', () => ({ trackRequest: () => () => {}, noteRequestFailure: () => {} }));

const { challengeOf, getBridgeLists, setTransport, verifyChallenge } = await import('./api');
const {
  canRunWebCheck,
  challengeFrom,
  clearanceChanged,
  clearanceOf,
  cookiesFromHeader,
  registerWebCheckRunner,
  runWebCheck,
  storageComplete,
  storageReadScript,
  storageValues,
  webViewUserAgent,
} = await import('./web-check');

const challenged = () =>
  new Response(
    JSON.stringify({ error: '[challenge:…] x', challenge: { url: 'https://www.site.test/list', userAgent: 'UA/1', reason: 'check' } }),
    { status: 403, headers: { 'Content-Type': 'application/json' } },
  );

let uninstall: (() => void) | undefined;
afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  setTransport(null);
});

describe('cookies from a web view', () => {
  test('a header string becomes the site’s cookies, scoped past its www.', () => {
    expect(cookiesFromHeader('cf_clearance=abc; sid=1=2; =x; sid=dup', 'https://www.site.test/a')).toEqual([
      { name: 'cf_clearance', value: 'abc', domain: 'site.test' },
      { name: 'sid', value: '1=2', domain: 'site.test' },
    ]);
  });

  test('through means a clearance cookie is new or changed', () => {
    const before = clearanceOf('cf_clearance=old; other=1');
    expect(clearanceChanged(before, clearanceOf('cf_clearance=old; other=2'))).toBe(false);
    expect(clearanceChanged(before, clearanceOf('cf_clearance=new'))).toBe(true);
    expect(clearanceChanged(new Map(), clearanceOf('__ddg2_=x'))).toBe(true);
  });
});

describe('the web view User-Agent', () => {
  test('left alone when the bridge already sends the platform one, set otherwise', () => {
    expect(webViewUserAgent('Mozilla/5.0 (iPhone) Mobile/15E148', 'Mozilla/5.0 (iPhone) Mobile/15E148')).toBeUndefined();
    expect(webViewUserAgent(undefined, 'Mozilla/5.0 (iPhone)')).toBeUndefined();
    expect(webViewUserAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/130.0', 'Mozilla/5.0 (iPhone)')).toBe('Mozilla/5.0 (Windows NT 10.0) Chrome/130.0');
    expect(webViewUserAgent('UA/1', null)).toBe('UA/1');
  });
});

describe('page storage', () => {
  test('a host challenge naming storage keys keeps them; junk is dropped', () => {
    expect(challengeFrom({ url: 'https://s.test/', storage: ['clearance', 3, ''], reason: '' })).toEqual({
      url: 'https://s.test/',
      storage: ['clearance'],
      reason: 'The site wants to check you are a person',
    });
    expect(challengeFrom({ url: 'javascript:1' })).toBeUndefined();
    expect(challengeFrom(null)).toBeUndefined();
  });

  test('the read script reports the keys that are set', () => {
    const store = new Map([['clearance', 'tok'], ['other', 'x']]);
    const localStorage = { getItem: (k: string) => store.get(k) ?? null };
    const report = new Function('localStorage', `return ${storageReadScript(['clearance', 'missing'])}`)(localStorage) as string;
    expect(storageValues(report)).toEqual({ clearance: 'tok' });
    expect(storageValues('not json')).toEqual({});
    expect(storageValues({ a: 1, b: 'y' })).toEqual({ b: 'y' });
  });

  test('done once every key is set and one is new or changed', () => {
    expect(storageComplete(['a', 'b'], {}, { a: '1' })).toBe(false);
    expect(storageComplete(['a', 'b'], {}, { a: '1', b: '2' })).toBe(true);
    expect(storageComplete(['a'], { a: 'old' }, { a: 'old' })).toBe(false);
    expect(storageComplete(['a'], { a: 'old' }, { a: 'new' })).toBe(true);
    expect(storageComplete([], {}, {})).toBe(false);
  });

  test('values the runner read go to the import with the cookies', async () => {
    uninstall = registerWebCheckRunner(async () => ({ cookies: [], values: { clearance: 'tok' } }));
    const imports: unknown[] = [];
    expect(await runWebCheck('b', { url: 'https://s.test/', storage: ['clearance'], reason: 'r' }, async (body) => void imports.push(body))).toBe(true);
    expect(imports).toEqual([{ url: 'https://s.test/', cookies: [], values: { clearance: 'tok' } }]);
  });
});

describe('runWebCheck', () => {
  test('no runner, no check', async () => {
    expect(canRunWebCheck()).toBe(false);
    expect(await runWebCheck('b', { url: 'https://s.test/', reason: 'r' }, async () => {})).toBe(false);
  });

  test('one check per bridge and site at a time; what the person earned is imported with the User-Agent', async () => {
    let calls = 0;
    let release!: () => void;
    uninstall = registerWebCheckRunner(async () => {
      calls++;
      await new Promise<void>((r) => (release = r));
      return { cookies: [{ name: 'cf_clearance', value: 'ok' }] };
    });
    const imports: unknown[] = [];
    const run = () => runWebCheck('b', { url: 'https://s.test/a', userAgent: 'UA/1', reason: 'r' }, async (body) => void imports.push(body));
    const both = Promise.all([run(), run()]);
    await Promise.resolve();
    release();
    expect(await both).toEqual([true, true]);
    expect(calls).toBe(1);
    expect(imports).toEqual([{ url: 'https://s.test/a', userAgent: 'UA/1', cookies: [{ name: 'cf_clearance', value: 'ok' }] }]);
  });

  test('given up on, or a failed import, is false', async () => {
    uninstall = registerWebCheckRunner(async () => null);
    expect(await runWebCheck('b', { url: 'https://s.test/', reason: 'r' }, async () => {})).toBe(false);
    uninstall();
    uninstall = registerWebCheckRunner(async () => ({ cookies: [] }));
    expect(
      await runWebCheck('b', { url: 'https://s.test/', reason: 'r' }, async () => {
        throw new Error('no');
      }),
    ).toBe(false);
  });
});

describe('through the API', () => {
  test('a request that meets a check runs it, imports the cookies and goes again', async () => {
    const seen: { path: string; method: string; body?: string }[] = [];
    let cleared = false;
    setTransport(async (path, init) => {
      seen.push({ path, method: init?.method ?? 'GET', ...(typeof init?.body === 'string' ? { body: init.body } : {}) });
      if (path.endsWith('/cookies')) {
        cleared = true;
        return new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } });
      }
      return cleared ? new Response('[]', { headers: { 'Content-Type': 'application/json' } }) : challenged();
    });
    uninstall = registerWebCheckRunner(async (c) => {
      expect(c).toEqual({ url: 'https://www.site.test/list', userAgent: 'UA/1', reason: 'check' });
      return { cookies: [{ name: 'cf_clearance', value: 'ok', domain: 'site.test' }] };
    });
    expect(await getBridgeLists('the-bridge')).toEqual([]);
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual([
      'GET /bridges/the-bridge/lists',
      'POST /bridges/the-bridge/cookies',
      'GET /bridges/the-bridge/lists',
    ]);
    expect(JSON.parse(seen[1]!.body!)).toEqual({ url: 'https://www.site.test/list', userAgent: 'UA/1', cookies: [{ name: 'cf_clearance', value: 'ok', domain: 'site.test' }] });
  });

  test('a check given up on leaves the error carrying it, and Verify runs it again', async () => {
    let passed = false;
    setTransport(async (path) => {
      if (path.endsWith('/cookies')) return new Response('{"ok":true}');
      return challenged();
    });
    uninstall = registerWebCheckRunner(async () => (passed ? { cookies: [{ name: 'cf_clearance', value: 'ok' }] } : null));
    const err = await getBridgeLists('the-bridge').catch((e: unknown) => e);
    expect(challengeOf(err)).toEqual({ url: 'https://www.site.test/list', userAgent: 'UA/1', reason: 'check', bridgeId: 'the-bridge' });
    expect((err as Error).message).toBe('check');
    passed = true;
    expect(await verifyChallenge(err)).toBe(true);
  });
});
