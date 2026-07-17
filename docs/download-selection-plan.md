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
- **Choose range…** — two number steppers (From / To, in reading order, prefilled with the first
  undownloaded → last chapter). Enqueues the span, skipping already-complete chapters (idempotent
  anyway — the core keeps completed pages).

While a download is in flight the sheet (reached via the Downloads screen or the partial button
after it settles) is still the "add more" surface — enqueueing more chapters into a draining queue
is already safe and ordered.

## 3. Chapter-row long-press: the range gesture

Long-press any chapter row → a small context menu:

- **Download this chapter** (or **Delete download** when complete)
- **Download from here** — `21 chapters` — this chapter through the end of reading order. This is
  the one-gesture answer to "30 through 50": long-press chapter 30, tap once.

The row already renders the download-state glyph, so the result is immediately visible in place,
per-chapter, as the queue drains (the indicators are live-patched). Long-press works on native and
web (the app's `Pressable`s support it); no multi-select mode is needed for v1 — contiguous ranges
cover the stated cases, and a select-mode can layer on later without changing any of this.

## 4. Resume / management stays where it is

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
  `range(chapters, fromNumber, toNumber)`; all return `Chapter[]` handed to the existing
  `enqueueChapter` facade loop.
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
3. Range picker granularity: steppers by reading-order position (robust against weird decimal
   numbering) vs by chapter number (matches what users see). Proposal: position-based steppers that
   *display* the chapter name/number at each end.
