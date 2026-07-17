# Download selection — proposal

## The problem

The series Download button is all-or-nothing: one tap enqueues every chapter. For a 50-chapter
series that's a big, possibly unwanted commitment (bandwidth, server/device storage), and there is
no way to say "just the next 15", "only 30–50", or later, "now the rest".

Worse, the button **misreports partial downloads today**: `deriveSeriesState` reads only the
manifest (the chapters that have download records), so 15-of-50 fully downloaded renders as
**"✓ Downloaded"** — indistinguishable from all 50. The button never learned the series has 50
chapters even though the screen holds the full list.

## Guiding UX

The proven pattern for this exact domain (Tachiyomi/Mihon lineage) is: a **download menu** on the
series action (all / unread / next-N / range), plus **"download from here" on a chapter row** for
ranges. Both map cleanly onto what the app already has — the full chapter list with `read` flags and
numbers, per-chapter download indicators, the manifest query, and the overlay/sheet system — and
onto a backend that is *already per-chapter*: selection is purely a client concern; every option
below just computes a chapter subset and fires the existing per-chapter enqueues. **No backend
changes required.**

## 1. The button tells the truth

`SeriesDownloadButton` already receives `chapters` — compare the manifest against it:

| Situation | Label | Tap |
|---|---|---|
| nothing downloaded | `⤓  Download` | open the download sheet |
| in flight | radial + `Downloading` (unchanged) | Downloads screen, focused (unchanged) |
| partial, idle (M of N complete, nothing pending) | `⤓  15 / 50` | open the download sheet (context-aware) |
| all N complete | `✓  Downloaded` | Downloads screen (unchanged) |

The partial label is the state that doesn't exist today — it both fixes the "Downloaded" lie and
advertises that there's more to get. (Direct/chapterless series keep the current two-state behavior;
they're a single unit.)

**Tap-to-sheet replaces tap-to-download-all.** One extra tap, in exchange for: no accidental
50-chapter downloads, and a home for every selection option. The sheet's primary action is still
"All", so the old behavior is two taps at most.

## 2. The download sheet

Opened from the button (and from the card long-press action, which currently also downloads-all).
Built on the existing overlay system (`useOverlay`, same chrome as the settings pickers). Options are
computed from `chapters` (reading order via `number`), `read` flags, and the `seriesDownloads`
manifest — each row shows its computed count and disables at zero:

- **Download all** — `N chapters` (or **Download remaining — 35** when partial: all minus already
  complete/in-flight; this is the "resume the rest" answer)
- **Download unread** — `M chapters` (unread and not yet downloaded)
- **Next 10** — the next unread-undownloaded chapters in reading order from the reading position
  (fallback: after the highest downloaded chapter; fallback: from the start)
- **Select chapters…** — opens the multi-select chapter list (below): a recycled `LegendList` of
  every chapter with checkboxes, tap-to-toggle, and long-press range fill. This is the power tool
  that answers "30 through 50" and any non-contiguous pick, replacing the earlier steppers idea.

While a download is in flight the sheet (reached via the Downloads screen or the partial button
after it settles) is still the "add more" surface — enqueueing more chapters into a draining queue
is already safe and ordered.

## 3. Multi-select — a new, reusable pattern

This is the codebase's **first multi-select**, so the machinery is designed as a standalone,
list-agnostic kit under `components/multi-select/` — the chapter picker is merely its first
consumer. Future consumers with zero new machinery: Library batch actions (remove / move to list),
Downloads screen batch delete, registry bulk install.

### The kit

- **`use-multi-select.ts`** — the selection store: `useMultiSelect<K>(allKeys)` returning
  `{ selected: ReadonlySet<K>, count, toggle(k), selectAll(), clear(), invert(),
  rangeFill(k) }`. `toggle` records the key as the **anchor**; `rangeFill(k)` (bound to long-press)
  selects everything between the anchor and `k` in `allKeys` order — the standard manga-app
  "tap 30, long-press 50" span gesture. Plain `useState<Set>` inside; no new state library.
- **`selectable-row.tsx`** — the row chrome: a leading check circle (filled accent when selected,
  hollow hairline when not) wrapping arbitrary row content, with `onPress → toggle` and
  `onLongPress → rangeFill`. **Recycling-safe by construction**: selection is passed IN as a
  `selected: boolean` prop derived from the Set — a row never holds selection in local state, so a
  recycled view can never carry a stale checkmark (the same rule the swipe rows follow for gesture
  state via `useRecyclingEffect`).
- **`select-bar.tsx`** — the header strip: `N selected` + `All` / `Invert` / `Clear` text actions,
  and a slot for the screen's primary CTA (here: **Download 21**, disabled at 0).

### LegendList specifics (the part that must be right once)

Same discipline as the Downloads screen list: `recycleItems` with `getItemType`, fixed row height
via `getFixedItemSize`, and **stable row objects** — each item's object identity changes only when
its own `selected` flag or data changes (the `buildRows`-style cache), so toggling one checkbox
re-renders one row, not five hundred. Items are always non-null objects (the list ends at a bare
`null`).

### The chapter picker (first consumer)

`components/series/chapter-select-sheet.tsx`: opened from the download sheet's **Select chapters…**,
presented in the existing overlay (bottom sheet on phones, anchored popover on desktop) with the
`LegendList` capped at ~70% viewport height. Rows show the chapter name, date, the existing
download-state glyph (a complete chapter renders checked-and-dimmed — selectable but excluded from
the CTA count; enqueueing it would be a harmless no-op anyway), and unread styling. The select bar's
CTA reads **Download N** and fires the standard per-chapter enqueue loop.

Risk to validate early: LegendList scroll inside the overlay's drag-to-dismiss sheet (gesture
nesting). The overlay already hosts scrollable content, but if the two gestures fight on native,
the fallback presentation is a dedicated route (like the Downloads screen) with identical contents —
the kit doesn't care where it's mounted.

## 4. Chapter-row long-press: the range gesture

Long-press any chapter row → a small context menu:

- **Download this chapter** (or **Delete download** when complete)
- **Download from here** — `21 chapters` — this chapter through the end of reading order. This is
  the one-gesture answer to "30 through 50": long-press chapter 30, tap once.

The row already renders the download-state glyph, so the result is immediately visible in place,
per-chapter, as the queue drains (the indicators are live-patched). Long-press works on native and
web (the app's `Pressable`s support it); no multi-select mode is needed for v1 — contiguous ranges
cover the stated cases, and a select-mode can layer on later without changing any of this.

## 5. Resume / management stays where it is

Pause/resume/retry/cancel of *enqueued* work remains the Downloads screen's job (per-chapter and
per-series swipes, already engine-backed). "Resume the remaining 35" is not a pause/resume concept —
it's a fresh selection, and it lives in the sheet as **Download remaining**. The two surfaces stay
cleanly split: the series page decides *what* to download; the Downloads screen manages *work in
flight and space*.

## Mechanics (all client-side)

- `download-button.tsx`: partial-state derivation (`manifest complete-count` vs `chapters.length`),
  label change, tap → sheet.
- New `components/series/download-sheet.tsx`: the option list; selection helpers (pure, unit-testable)
  in `data/downloads/select.ts` — `remaining(chapters, manifest)`, `unread(...)`, `nextN(...)`,
  `fromHere(chapters, chapterId)`; all return `Chapter[]` handed to the existing `enqueueChapter`
  facade loop.
- New `components/multi-select/` kit (`use-multi-select.ts`, `selectable-row.tsx`, `select-bar.tsx`)
  + `components/series/chapter-select-sheet.tsx` as its first consumer (see §3).
- `chapters-section.tsx`: `onLongPress` on `ChapterRow` → context menu (overlay) with the two
  download actions; wired through the same helpers.
- `use-series-download-action.ts` (card long-press): opens the sheet instead of enqueueing all.
- Logical chapters: selection operates on logical chapter groups (like the list renders); enqueue
  downloads the group's `pickVersion` default — same version the row would open.

## Open questions

1. **Next-N size** — fixed "Next 10", or 5/10/25 variants (menu clutter vs flexibility)? Proposal:
   single **Next 10** to start.
2. Should **tap on a partial button** skip the sheet and directly "download remaining"? Proposal:
   no — sheet, since partial users are exactly the ones curating.
3. Multi-select presentation: overlay sheet (consistent with every other picker) vs a dedicated
   route (roomier for 1000-chapter series, no gesture nesting). Proposal: overlay first, fall back
   to a route only if the nested-scroll gesture fights on native.
