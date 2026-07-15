/**
 * The eval harness. Runs both arms through the merge scenarios that are easy to get wrong, and
 * prints a pass/fail matrix. The headline question isn't "does it sync" (both do) — it's whether
 * each arm keeps read progress from rolling back under a stale concurrent write.
 */
import { HandrollStore } from './handroll';
import { TinybaseStore } from './tinybase-arm';
import { resumePoint, type ChapterProgress } from './model';

let pass = 0;
let fail = 0;
const rows: { section: string; arm: string; check: string; ok: boolean; detail: string }[] = [];
function check(section: string, arm: string, name: string, ok: boolean, detail = ''): void {
  rows.push({ section, arm, check: name, ok, detail });
  ok ? pass++ : fail++;
}

// A shared, test-controlled wall clock for the hand-roll arm (deterministic HLC ordering).
const time = { t: 1000 };
const handroll = (node: string) => new HandrollStore(node, () => time.t);
const prog = (o: Partial<ChapterProgress> & { chapterId: string }): ChapterProgress => ({
  chapterNumber: 1, page: 0, pageCount: 20, completed: false, ...o,
});

// ── Section A — LWW register + tombstone (library entries) ────────────────────
// A adds & favourites an entry; B concurrently removes it *later*. Remove must win on both.
{
  const A = handroll('A'); const B = handroll('B');
  time.t = 1000; A.putEntry({ key: 's1', title: 'One', favorite: true });
  A.merge(B.snapshot()); B.merge(A.snapshot());          // B learns of s1
  time.t = 2000; B.removeEntry('s1');                     // B removes it, later
  time.t = 1500; A.putEntry({ key: 's1', title: 'One', favorite: false }); // A edits it, earlier
  A.merge(B.snapshot()); B.merge(A.snapshot());
  const aGone = A.liveEntries().length === 0;
  const bGone = B.liveEntries().length === 0;
  check('A: LWW+tombstone', 'handroll', 'remove(t=2000) beats edit(t=1500) on both devices', aGone && bGone,
    `A entries=${A.liveEntries().length} B entries=${B.liveEntries().length}`);
}
{
  const A = new TinybaseStore('A'); const B = new TinybaseStore('B');
  A.putEntry({ key: 's1', title: 'One', favorite: true });
  A.merge(B); B.merge(A);
  A.putEntry({ key: 's1', title: 'One', favorite: false }); // earlier edit
  B.removeEntry('s1');                                      // later remove
  A.merge(B); B.merge(A);
  check('A: LWW+tombstone', 'tinybase', 'later remove wins on both devices',
    A.liveEntries().length === 0 && B.liveEntries().length === 0,
    `A entries=${A.liveEntries().length} B entries=${B.liveEntries().length}`);
}

// ── Section B — set add/remove (registries) ──────────────────────────────────
{
  const A = handroll('A'); const B = handroll('B');
  time.t = 1000; A.addRegistry({ url: 'https://r1', name: 'R1' });
  time.t = 1100; A.addRegistry({ url: 'https://r2', name: 'R2' });
  A.merge(B.snapshot()); B.merge(A.snapshot());
  time.t = 2000; B.removeRegistry('https://r1');           // B drops r1 later
  A.merge(B.snapshot()); B.merge(A.snapshot());
  const conv = JSON.stringify(A.liveRegistries()) === JSON.stringify(B.liveRegistries());
  check('B: set add/remove', 'handroll', 'r1 removed, r2 kept, both converged',
    conv && A.liveRegistries().join(',') === 'https://r2', `A=${A.liveRegistries()} B=${B.liveRegistries()}`);
}
{
  const A = new TinybaseStore('A'); const B = new TinybaseStore('B');
  A.addRegistry({ url: 'https://r1', name: 'R1' });
  A.addRegistry({ url: 'https://r2', name: 'R2' });
  A.merge(B); B.merge(A);
  B.removeRegistry('https://r1');
  A.merge(B); B.merge(A);
  const conv = JSON.stringify(A.liveRegistries()) === JSON.stringify(B.liveRegistries());
  check('B: set add/remove', 'tinybase', 'r1 removed, r2 kept, both converged',
    conv && A.liveRegistries().join(',') === 'https://r2', `A=${A.liveRegistries()} B=${B.liveRegistries()}`);
}

// ── Section C — MONOTONIC read progress (the decisive one) ───────────────────
// A reads a chapter to page 10. B, offline & stale, opens the same chapter and reads only to
// page 3 at a LATER wall-clock time. After sync, progress must NOT roll back to page 3.
{
  const A = handroll('A'); const B = handroll('B');
  time.t = 1000; A.putProgress('s1', prog({ chapterId: 'c1', chapterNumber: 5, page: 10 }));
  A.merge(B.snapshot()); B.merge(A.snapshot());
  time.t = 5000; B.putProgress('s1', prog({ chapterId: 'c1', chapterNumber: 5, page: 3 })); // later, less
  A.merge(B.snapshot()); B.merge(A.snapshot());
  const aPage = resumePoint(A.progressRows('s1'))?.page;
  const bPage = resumePoint(B.progressRows('s1'))?.page;
  check('C: monotonic progress', 'handroll', 'furthest page (10) survives a later stale write',
    aPage === 10 && bPage === 10, `A page=${aPage} B page=${bPage}`);
}
{
  const A = new TinybaseStore('A'); const B = new TinybaseStore('B');
  A.putProgress('s1', prog({ chapterId: 'c1', chapterNumber: 5, page: 10 }));
  A.merge(B); B.merge(A);
  B.putProgress('s1', prog({ chapterId: 'c1', chapterNumber: 5, page: 3 })); // executed later ⇒ later HLC
  A.merge(B); B.merge(A);
  const aPage = A.progressRows('s1')[0]?.page;
  const bPage = B.progressRows('s1')[0]?.page;
  check('C: monotonic progress', 'tinybase', 'furthest page (10) survives a later stale write',
    aPage === 10 && bPage === 10, `A page=${aPage} B page=${bPage} (LWW picked the later write)`);
}

// ── Section D — order independence (hand-roll: merge is a pure semilattice join) ──
{
  // Same three ops delivered to two devices in opposite orders ⇒ identical state.
  const mk = () => {
    const s = handroll('X'); return s;
  };
  time.t = 1000; const op1 = handroll('A'); op1.putEntry({ key: 's9', title: 'Nine', favorite: true });
  time.t = 1001; const op2 = handroll('B'); op2.addRegistry({ url: 'https://r9', name: 'R9' });
  time.t = 1002; const op3 = handroll('C'); op3.putProgress('s9', prog({ chapterId: 'c9', chapterNumber: 2, page: 7 }));
  const d1 = mk(); d1.merge(op1.snapshot()); d1.merge(op2.snapshot()); d1.merge(op3.snapshot());
  const d2 = mk(); d2.merge(op3.snapshot()); d2.merge(op1.snapshot()); d2.merge(op2.snapshot());
  const same = JSON.stringify(d1.snapshot()) === JSON.stringify(d2.snapshot());
  check('D: order independence', 'handroll', 'reordered delivery ⇒ identical state', same);
}

// ── Report ───────────────────────────────────────────────────────────────────
const pad = (s: string, n: number) => s.padEnd(n);
console.log('\n' + pad('SECTION', 24) + pad('ARM', 10) + pad('RESULT', 8) + 'CHECK / DETAIL');
console.log('─'.repeat(96));
let lastSection = '';
for (const r of rows) {
  const sec = r.section === lastSection ? '' : r.section; lastSection = r.section;
  console.log(pad(sec, 24) + pad(r.arm, 10) + pad(r.ok ? '✅ PASS' : '❌ FAIL', 8) + r.check + (r.detail ? `  — ${r.detail}` : ''));
}
console.log('─'.repeat(96));
console.log(`\n${pass} passed, ${fail} failed\n`);
console.log('Reading of the failures: TinyBase is correct on LWW + sets + tombstones, but LWW-per-cell');
console.log('cannot express the monotonic progress join, so a later stale write rolls read position back.');
