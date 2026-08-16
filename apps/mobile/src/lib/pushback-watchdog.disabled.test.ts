import { describe, expect, mock, test } from 'bun:test';

// The other half of `pushback-watchdog.test.ts`: that file mocks the build gate ON and checks the
// rule; this one mocks it OFF and checks that nothing happens at all. Worth its own file because the
// gate is the whole of what keeps this machinery out of a public build, and "it costs nothing when
// disabled" is exactly the kind of claim that quietly stops being true.
const logged: unknown[] = [];
mock.module('@/lib/diagnostics', () => ({
  logDiagnostic: (...args: unknown[]) => {
    logged.push(args);
  },
}));
mock.module('@/lib/profiling', () => ({ PROFILING_ENABLED: false }));

const { armSettleCheck, notePushback, reportStuck, SETTLE_MS } = await import('./pushback-watchdog');

describe('with PROFILING_ENABLED false', () => {
  test('reports nothing and never reads or touches the signal', async () => {
    let reads = 0;
    let rested = false;
    notePushback('overlay open', 'id=1');
    reportStuck('overlay-sheet', 'this should not be written anywhere');
    armSettleCheck('test-signal', {
      read: (then) => {
        reads += 1;
        then(1);
      },
      rest: () => {
        rested = true;
      },
    });

    await new Promise((r) => setTimeout(r, SETTLE_MS + 30));
    expect(logged).toHaveLength(0);
    expect(reads).toBe(0);
    expect(rested).toBe(false);
  });
});
