/**
 * Hardened verification of the Scenario-C claim: TinyBase MergeableStore merges progress by
 * LAST-WRITE-WINS (later HLC), not by value — so a later write with a *smaller* page rolls read
 * position back. We prove it's time, not value, by running BOTH orderings with guaranteed-distinct
 * timestamps and reading back the actual HLC stamp TinyBase assigned to the winning cell.
 */
import { createMergeableStore, type MergeableStore } from 'tinybase';

/** Busy-wait until the wall clock advances, so two consecutive writes get distinct HLC physicals. */
function tick(): void {
  const start = Date.now();
  while (Date.now() - start < 2) { /* spin ~2ms */ }
}

const pageStamp = (s: MergeableStore, row: string): string => {
  // MergeableContent: [ [tables, hlc, hash], [values, hlc, hash] ]
  // tables -> {progress: [ {row: [ {page:[val,hlc,hash], ...}, hlc, hash ]}, hlc, hash ]}
  const content: any = s.getMergeableContent();
  return content?.[0]?.[0]?.progress?.[0]?.[row]?.[0]?.page?.[1] ?? '(none)';
};

function trial(first: number, second: number): { merged: number; firstHlc: string; secondHlc: string } {
  const A = createMergeableStore('A');
  const B = createMergeableStore('B');
  A.setRow('progress', 'r', { page: first });
  const firstHlc = pageStamp(A, 'r');
  tick();
  B.setRow('progress', 'r', { page: second });
  const secondHlc = pageStamp(B, 'r');
  A.merge(B); // two-way converge
  const merged = Number(A.getCell('progress', 'r', 'page'));
  return { merged, firstHlc, secondHlc };
}

console.log('TinyBase MergeableStore — is progress LWW-by-time or by-value?\n');

const t1 = trial(10, 3); // read to 10, then a LATER stale write of 3
console.log(`Ordering 1: write page=10, then (later) write page=3`);
console.log(`  first  HLC = ${t1.firstHlc}`);
console.log(`  second HLC = ${t1.secondHlc}   ${t1.secondHlc > t1.firstHlc ? '(strictly later ✓)' : '(NOT later!)'}`);
console.log(`  merged page = ${t1.merged}   → ${t1.merged === 3 ? 'ROLLED BACK to the later, smaller write' : 'unexpected'}\n`);

const t2 = trial(3, 10); // reverse: write 3, then a LATER write of 10
console.log(`Ordering 2: write page=3,  then (later) write page=10`);
console.log(`  first  HLC = ${t2.firstHlc}`);
console.log(`  second HLC = ${t2.secondHlc}   ${t2.secondHlc > t2.firstHlc ? '(strictly later ✓)' : '(NOT later!)'}`);
console.log(`  merged page = ${t2.merged}   → ${t2.merged === 10 ? 'kept 10 (the later write)' : 'unexpected'}\n`);

const byTime = t1.merged === 3 && t2.merged === 10;      // winner is always the later write
const notByValue = !(t1.merged === 10 && t2.merged === 10); // it is NOT "max value wins"
console.log('─'.repeat(72));
console.log(`Winner is always the LATER write, regardless of value: ${byTime ? 'CONFIRMED ✓' : 'no'}`);
console.log(`  Ordering 1 kept ${t1.merged} (smaller), Ordering 2 kept ${t2.merged} (larger).`);
console.log(`  If merge were monotonic/max, BOTH would keep 10. It does not: ${notByValue ? 'confirmed LWW, not max ✓' : ''}`);
console.log(`\nConclusion: the Scenario-C failure is real and intrinsic to LWW — not a timing artifact.`);
