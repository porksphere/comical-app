import { beforeEach, describe, expect, mock, test } from 'bun:test';

// The watchdog is what turns "the app zoomed out and dimmed and stayed that way" from a bug report
// nobody can act on into a persisted log entry plus a self-recovery. Both halves are worth holding
// still: a check that never fires leaves the app stuck, and one that fires when it shouldn't shoves
// a legitimately-opening overlay back to zero mid-entrance.

// The persisted log stands in for the real one — this is about WHAT gets written and when, not
// about AsyncStorage. It also has to be a mock rather than the real module: `mock.module` is
// process-global in bun, and two other suites replace `@/lib/diagnostics` with a `logDiagnostic`-only
// stub, so a test that imported the real thing here would break on the order they happen to run in.
type Logged = { category: string; message: string; context?: string };
const logged: Logged[] = [];
mock.module('@/lib/diagnostics', () => ({
  logDiagnostic: (category: string, message: string, opts: { context?: string } = {}) => {
    logged.push({ category, message, context: opts.context });
  },
}));
// The build gate the whole module hangs off. Mocked ON here so these tests exercise the RULE; the
// off case is `pushback-watchdog.disabled.test.ts`. It also has to be mocked rather than imported at
// all: `PROFILING_ENABLED` reads the bare `__DEV__` global, which doesn't exist outside a Metro
// bundle and would throw the moment this file loaded.
mock.module('@/lib/profiling', () => ({ PROFILING_ENABLED: true }));

const { armSettleCheck, cancelSettleCheck, notePushback, SETTLE_MS } = await import('./pushback-watchdog');
type PushbackSignal = import('./pushback-watchdog').PushbackSignal;

/** A signal whose value is whatever the test says it is, recording whether it was put back. */
function fakeSignal(value: number): PushbackSignal & { rested: boolean; reads: number } {
  const signal = {
    reads: 0,
    rested: false,
    read(then: (v: number) => void) {
      signal.reads += 1;
      // Asynchronous, like the real round trip to the UI thread.
      setTimeout(() => then(value), 0);
    },
    rest() {
      signal.rested = true;
    },
  };
  return signal;
}

const settled = () => new Promise((r) => setTimeout(r, SETTLE_MS + 30));

const SOURCE = 'test-signal';

beforeEach(() => {
  cancelSettleCheck(SOURCE);
  logged.length = 0;
});

describe('armSettleCheck', () => {
  test('reports and recovers a signal left pushed back', async () => {
    const signal = fakeSignal(0.93);
    armSettleCheck(SOURCE, signal, () => 'items=0');
    await settled();

    const [entry] = logged;
    expect(entry?.category).toBe('stuck-pushback');
    expect(entry?.message).toContain(SOURCE);
    expect(entry?.message).toContain('0.930');
    // The run-up goes in with it: the whole point of the persisted entry is being readable long
    // after the frame that caused it.
    expect(entry?.context).toContain('items=0');
    expect(signal.rested).toBe(true);
  });

  test('says nothing about a signal that came back to rest', async () => {
    const signal = fakeSignal(0);
    armSettleCheck(SOURCE, signal, () => 'items=0');
    await settled();

    expect(logged).toHaveLength(0);
    expect(signal.rested).toBe(false);
  });

  // A spring settles at 1e-4, not at 0.
  test('treats a hair off zero as at rest', async () => {
    const signal = fakeSignal(0.0001);
    armSettleCheck(SOURCE, signal);
    await settled();

    expect(logged).toHaveLength(0);
    expect(signal.rested).toBe(false);
  });

  test('a signal taken again before the check fires is not reported', async () => {
    const signal = fakeSignal(1);
    armSettleCheck(SOURCE, signal);
    cancelSettleCheck(SOURCE); // an overlay opened again

    await settled();
    expect(signal.reads).toBe(0);
    expect(logged).toHaveLength(0);
  });

  // The gap this covers is real and sub-frame: an overlay can open between the check firing and the
  // re-render that would have cancelled it, and reporting THAT as a strand would also shove its
  // entrance animation back to zero.
  test('a signal that has an owner again by the time the check fires is not reported', async () => {
    const signal = fakeSignal(1);
    let idle = true;
    armSettleCheck(
      SOURCE,
      signal,
      () => '',
      () => idle,
    );
    idle = false;

    await settled();
    expect(logged).toHaveLength(0);
    expect(signal.rested).toBe(false);
  });

  test('re-arming replaces the pending check rather than stacking a second one', async () => {
    const first = fakeSignal(1);
    const second = fakeSignal(1);
    armSettleCheck(SOURCE, first);
    armSettleCheck(SOURCE, second);

    await settled();
    expect(first.reads).toBe(0);
    expect(second.reads).toBe(1);
    expect(logged).toHaveLength(1);
  });
});

describe('the trail', () => {
  test('carries the run-up into the report, newest last, and stays bounded', async () => {
    // Comfortably more than the trail's own capacity, so the oldest have to fall off.
    for (let i = 0; i < 40; i += 1) notePushback('overlay open', `id=${i}`);
    armSettleCheck(SOURCE, fakeSignal(0.5));
    await settled();

    const context = logged[0]?.context ?? '';
    expect(context).toContain('id=39');
    expect(context).not.toContain('id=0 ');
    expect(context.split('\n').length).toBeLessThan(30);
  });
});
