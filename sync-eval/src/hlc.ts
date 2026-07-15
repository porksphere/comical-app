/**
 * Hybrid Logical Clock — a totally-ordered, per-device-monotonic timestamp that stays close to
 * wall-clock but never goes backwards and breaks ties deterministically by device id. This is the
 * ordering primitive the whole CRDT-lite core is built on (see docs/CROSS-DEVICE-SYNC.md).
 *
 * Packed form "<physicalMs>:<counter>:<node>" so a stamp is a plain comparable/serialisable string.
 */
export type Hlc = { physical: number; counter: number; node: string };

export function pack(h: Hlc): string {
  // zero-pad physical + counter so lexical order == numeric order for the first two fields
  return `${h.physical.toString().padStart(15, '0')}:${h.counter.toString().padStart(6, '0')}:${h.node}`;
}
export function unpack(s: string): Hlc {
  const [p, c, node] = s.split(':');
  return { physical: Number(p), counter: Number(c), node };
}

/** −1 / 0 / 1 total order: physical, then counter, then node id. */
export function compare(a: Hlc, b: Hlc): number {
  if (a.physical !== b.physical) return a.physical < b.physical ? -1 : 1;
  if (a.counter !== b.counter) return a.counter < b.counter ? -1 : 1;
  if (a.node !== b.node) return a.node < b.node ? -1 : 1;
  return 0;
}

/** A per-device clock. `now()` is injected so tests can drive time deterministically. */
export class Clock {
  private last: Hlc;
  constructor(
    private readonly node: string,
    private readonly now: () => number,
  ) {
    this.last = { physical: 0, counter: 0, node };
  }

  /** Stamp a local write. */
  send(): Hlc {
    const wall = this.now();
    const next: Hlc =
      wall > this.last.physical
        ? { physical: wall, counter: 0, node: this.node }
        : { physical: this.last.physical, counter: this.last.counter + 1, node: this.node };
    this.last = next;
    return next;
  }

  /** Advance on receiving a remote stamp, so subsequent local writes sort after what we've seen. */
  recv(remote: Hlc): void {
    const wall = this.now();
    const lp = this.last.physical;
    const rp = remote.physical;
    let next: Hlc;
    if (wall > lp && wall > rp) next = { physical: wall, counter: 0, node: this.node };
    else if (lp === rp) next = { physical: lp, counter: Math.max(this.last.counter, remote.counter) + 1, node: this.node };
    else if (lp > rp) next = { physical: lp, counter: this.last.counter + 1, node: this.node };
    else next = { physical: rp, counter: remote.counter + 1, node: this.node };
    this.last = next;
  }
}
