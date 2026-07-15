/**
 * The "hand-roll" arm: a CRDT-lite store built from three merge primitives over HLC-stamped
 * envelopes. ~150 lines, zero deps. Merge is a pure function of two states, so any two devices that
 * have seen the same ops converge regardless of order or delivery timing.
 */
import { Clock, compare, unpack, type Hlc } from './hlc';
import type { ChapterProgress, LibraryEntry, Registry } from './model';

/** LWW register with tombstone. */
type Reg<T> = { value: T | null; hlc: string; deleted: boolean };
/** One LWW-element-set member. */
type SetElem = { present: boolean; hlc: string };

function mergeReg<T>(a: Reg<T>, b: Reg<T>): Reg<T> {
  return compare(unpack(a.hlc), unpack(b.hlc)) >= 0 ? a : b;
}
function mergeElem(a: SetElem, b: SetElem): SetElem {
  return compare(unpack(a.hlc), unpack(b.hlc)) >= 0 ? a : b;
}
/**
 * MONOTONIC join — the crux. No clock: the value domain is itself a semilattice, so furthest-read
 * always wins and the merge is intrinsically order-independent. A stale write can never roll back.
 */
function mergeProgress(a: ChapterProgress, b: ChapterProgress): ChapterProgress {
  return {
    chapterId: a.chapterId,
    chapterNumber: Math.max(a.chapterNumber, b.chapterNumber),
    page: Math.max(a.page, b.page),
    pageCount: Math.max(a.pageCount, b.pageCount),
    completed: a.completed || b.completed,
  };
}

export type Snapshot = {
  entries: Record<string, Reg<LibraryEntry>>;
  registries: Record<string, SetElem & { name: string }>;
  progress: Record<string, Record<string, ChapterProgress>>; // entryKey -> chapterId -> row
};

export class HandrollStore {
  private entries = new Map<string, Reg<LibraryEntry>>();
  private registries = new Map<string, SetElem & { name: string }>();
  private progress = new Map<string, Map<string, ChapterProgress>>();
  private clock: Clock;

  constructor(node: string, now: () => number) {
    this.clock = new Clock(node, now);
  }

  // ── local writes ──────────────────────────────────────────────────────────
  putEntry(e: LibraryEntry): void {
    this.entries.set(e.key, { value: e, hlc: this.stamp(), deleted: false });
  }
  removeEntry(key: string): void {
    this.entries.set(key, { value: null, hlc: this.stamp(), deleted: true });
  }
  addRegistry(r: Registry): void {
    this.registries.set(r.url, { present: true, hlc: this.stamp(), name: r.name });
  }
  removeRegistry(url: string): void {
    const prev = this.registries.get(url);
    this.registries.set(url, { present: false, hlc: this.stamp(), name: prev?.name ?? '' });
  }
  putProgress(entryKey: string, row: ChapterProgress): void {
    const table = this.progress.get(entryKey) ?? new Map();
    const prev = table.get(row.chapterId);
    // local writes go through the same monotonic join — re-reading an earlier page never rewinds.
    table.set(row.chapterId, prev ? mergeProgress(prev, row) : row);
    this.progress.set(entryKey, table);
  }

  private stamp(): string {
    const h: Hlc = this.clock.send();
    return `${h.physical.toString().padStart(15, '0')}:${h.counter.toString().padStart(6, '0')}:${h.node}`;
  }

  // ── reads ─────────────────────────────────────────────────────────────────
  liveEntries(): LibraryEntry[] {
    return [...this.entries.values()].filter((r) => !r.deleted && r.value).map((r) => r.value!);
  }
  liveRegistries(): string[] {
    return [...this.registries.entries()].filter(([, v]) => v.present).map(([url]) => url).sort();
  }
  progressRows(entryKey: string): ChapterProgress[] {
    return [...(this.progress.get(entryKey)?.values() ?? [])];
  }

  // ── sync adapter (backend-agnostic: full-state exchange here; a real backend ships deltas) ──
  snapshot(): Snapshot {
    return {
      entries: Object.fromEntries(this.entries),
      registries: Object.fromEntries(this.registries),
      progress: Object.fromEntries([...this.progress].map(([k, v]) => [k, Object.fromEntries(v)])),
    };
  }
  merge(remote: Snapshot): void {
    for (const [k, r] of Object.entries(remote.entries)) {
      this.clock.recv(unpack(r.hlc));
      const cur = this.entries.get(k);
      this.entries.set(k, cur ? mergeReg(cur, r) : r);
    }
    for (const [url, r] of Object.entries(remote.registries)) {
      this.clock.recv(unpack(r.hlc));
      const cur = this.registries.get(url);
      this.registries.set(url, cur ? { ...mergeElem(cur, r), name: r.name || cur.name } : r);
    }
    for (const [entryKey, rows] of Object.entries(remote.progress)) {
      const table = this.progress.get(entryKey) ?? new Map();
      for (const [chId, row] of Object.entries(rows)) {
        const cur = table.get(chId);
        table.set(chId, cur ? mergeProgress(cur, row) : row);
      }
      this.progress.set(entryKey, table);
    }
  }
}
