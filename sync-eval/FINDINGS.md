# Phase-0 sync spike — findings

**Question (from [docs/CROSS-DEVICE-SYNC.md](../docs/CROSS-DEVICE-SYNC.md)):** adopt a library
(TinyBase MergeableStore, then RxDB) for the sync merge + plumbing, or hand-roll the CRDT-lite core?
Success criteria: (a) integrates with the existing `LibraryStore` seam without rewriting the
file/AsyncStorage layers, (b) runs on JSC **and** QuickJS without a Wasm/bundle-size blowup, (c)
supports the backend-agnostic push/pull adapter.

**Verdict: hand-roll the CRDT-lite core.** Not because TinyBase is bad — it's excellent at what it
does — but because the one requirement that actually differentiates the options (monotonic read
progress) is native to the hand-roll and *cannot be expressed* in TinyBase's LWW-per-cell model,
while TinyBase's headline advantage (free persisters + synchronizer) doesn't fit our existing store
seam or the backend-agnostic + E2E transport we specified. RxDB was not spiked: once TinyBase — the
lighter, closer-fitting option — lost on integration + the progress model, RxDB (heavier, its own
collection/replication model, same "owns the storage" problem, larger footprint) could not win on
the criteria that decided it. Reopen it only if we later want a batteries-included replication stack
and are willing to migrate the store.

## How to reproduce

```bash
cd sync-eval && bun install && bun run src/run.ts
```

`src/handroll.ts` is the hand-roll arm (~150 lines, zero deps); `src/tinybase-arm.ts` is the same
three tables in a `MergeableStore`; `src/run.ts` runs both through the scenarios below.
`src/verify-c.ts` (`bun run src/verify-c.ts`) is the standalone hardened check of Scenario C.

## Results

### Merge correctness — the scenario matrix

| Scenario | Hand-roll | TinyBase | Notes |
| --- | :---: | :---: | --- |
| **A** — LWW register + tombstone (later remove beats earlier edit, both devices) | ✅ | ✅ | Both correct |
| **B** — set add/remove converges (drop one registry, keep the other) | ✅ | ✅ | Both correct |
| **C** — **monotonic progress** (furthest page survives a *later stale* write) | ✅ | ❌ | **TinyBase rolls back 10 → 3** |
| **D** — order independence (reordered delivery ⇒ identical state) | ✅ | — | Semilattice join |

**Scenario C is the whole ballgame.** Device A reads a chapter to page 10; device B — offline and
stale — later opens the same chapter and reads only to page 3. Because B's write is *later*,
TinyBase's LWW-per-cell merge picks it and **rolls the reader's position back to page 3 on both
devices**. This is exactly the "most common way sync corrupts a reader's history" the design warned
about. The hand-roll models progress as a semilattice (`page = max`, `completed = OR`), so
furthest-read always wins regardless of write order — page 10 holds.

You cannot fix this at the app layer *on top of* TinyBase: a local max-on-write doesn't help,
because the corruption happens inside TinyBase's cell merge when two devices' stores combine. To use
TinyBase you'd have to keep progress *outside* its cell-merge entirely — i.e. hand-roll the one hard
part anyway, then run two sync mechanisms side by side.

#### Verification of the Scenario-C claim (docs + hardened empirical test)

The claim was double-checked so it doesn't rest on my test's timing.

**Official docs — the merge is fixed LWW, with no override.** TinyBase's own guide states: *"Each
update gets a timestamp, based on a hybrid logical clock (HLC)… The resulting 'last write wins'
(LWW) approach allows the MergeableStore to act as a Conflict-Free Replicated Data Type (CRDT)."*
The MergeableStore API exposes **no** merge callback, per-cell merge strategy, or conflict-resolution
hook (checked the full interface). The only way to get non-LWW semantics is to swap to the
**Yjs/Automerge persisters** — precisely the heavier, Wasm-carrying options the design already ruled
out. Sources:
[Using a MergeableStore](https://tinybase.org/guides/synchronization/using-a-mergeablestore/),
[MergeableStore API](https://tinybase.org/api/mergeable-store/interfaces/mergeable/mergeablestore/).

**Hardened test — it's LWW-by-time, not by-value, and not a timing artifact** (`src/verify-c.ts`,
`bun run src/verify-c.ts`). Run both orderings with guaranteed-distinct HLCs and read back the stamp
TinyBase assigned to the winning cell:

| Ordering | second write strictly later? | merged `page` | |
| --- | :---: | :---: | --- |
| write 10, then 3 | ✓ (HLC `…GI3…` → `…GI8…`) | **3** | rolled back to the later, *smaller* write |
| write 3, then 10 | ✓ (HLC `…GIC…` → `…GIE…`) | **10** | kept the later write |

The winner is **always the later write regardless of magnitude**. If the merge were monotonic/max,
*both* orderings would keep 10 — they don't. So the rollback is intrinsic to LWW, confirmed
independently of how the writes were sequenced.

### Footprint (criterion b)

| Arm | Minified | Gzipped |
| --- | ---: | ---: |
| Hand-roll core (3-table demo) | ~3 KB | ~1 KB |
| TinyBase `MergeableStore` only | 36 KB | 15 KB |
| TinyBase + WS synchronizer | 44 KB | 18.5 KB |

TinyBase is **pure JS, zero transitive deps, no Wasm** — a real advantage over Automerge/Yjs on the
constrained engines, and 36–44 KB is not a "blowup." Footprint does not decide this; both pass (b)
on size. (The full 15 MB npm package is every UI-framework binding and build variant; subpath
exports mean only the ~36 KB above actually ships.)

### Engine compatibility (criterion b)

- **JSC:** ✅ verified. Bun's JS engine *is* JavaScriptCore, and the harness runs there.
- **QuickJS:** ✅ high confidence, one smoke test outstanding. No Wasm, and a scan of the imported
  `MergeableStore` bundle finds **none** of the historically-QuickJS-unsupported globals
  (`structuredClone`, `TextEncoder`/`TextDecoder`, `crypto.*`, `WeakRef`, `FinalizationRegistry`,
  `Proxy`, `Reflect`, `Intl.*`). The hand-roll uses only `Map`/`Set`/`Math`/string ops — trivially
  fine. Neither arm carries QuickJS risk that would block it; confirm with an on-device smoke test
  before committing either way.

### Integration with the existing seam (criterion a) — where it's actually decided

TinyBase **wants to own the data model**: its tabular store, its own content format, and its own
persisters. Adopting it means *migrating* the existing `LibraryStore` state (the specific
`comical:lib:*` / `comical:embedded:*` key layouts, and the server's file store) into TinyBase's
store and **swapping the persistence layer** for TinyBase persisters — not "wrapping the seam that
exists." That's the opposite of criterion (a).

The hand-roll adds `{value, hlc, deleted}` envelopes *at* the existing `LibraryStore` interface and
reuses the AsyncStorage + file-store implementations already written and shipping. No storage
migration, no persister swap.

TinyBase's genuine win — free persisters + a WebSocket synchronizer — is blunted twice: the
persisters don't match our stores, and the synchronizer is one transport, whereas the design calls
for a **backend-agnostic op-log with host + blob adapters and an E2E-encryption envelope** that we'd
wrap ourselves regardless.

## Scorecard

| Criterion | Hand-roll | TinyBase |
| --- | :---: | :---: |
| (a) Integrates with existing `LibraryStore` seam | ✅ reuses it | ❌ wants to own storage → migration |
| (b) JSC / QuickJS, no Wasm/bundle blowup | ✅ ~3 KB | ✅ ~36 KB, pure JS |
| (c) Backend-agnostic push/pull adapter | ✅ native | ⚠️ wrap its content API |
| Monotonic progress merge | ✅ native | ❌ impossible in cell-LWW |
| Free plumbing (persisters, synchronizer, HLC) | ❌ build it | ✅ — but doesn't fit our seam |

## Recommendation → phase 1

Proceed with the **hand-rolled CRDT-lite** described in the design doc:

1. HLC (`src/hlc.ts` here is a working, tested starting point).
2. Three merge primitives — LWW register + tombstone, LWW-element-set, monotonic progress join
   (`src/handroll.ts`).
3. Envelopes bolted onto the existing `LibraryStore` interface (no storage migration).
4. A backend-agnostic `push(ops)` / `pull(since)` adapter; ship the host-server hub adapter first,
   blob second, over the same op-log.

Keep TinyBase on the shelf as **confirmation that our merge semantics are industry-standard**
(HLC + LWW + tombstones is precisely what MergeableStore does) — we're re-implementing a proven
model, minus the one place (monotonic progress) where the general-purpose model is wrong for us.

This `sync-eval/` directory is a throwaway spike; the keeper code (`hlc.ts`, the merge functions)
graduates into `apps/mobile/src/data/sync/` (and the comical submodule's server) in phase 1.
