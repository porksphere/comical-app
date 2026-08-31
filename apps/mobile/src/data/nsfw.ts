/**
 * NSFW visibility (persisted, not dev-gated). Four states, picked from Settings:
 *   - 'off' / 'on': durable — written to disk, so they're still in effect after
 *     the app is force-quit and relaunched.
 *   - 'until-background': a session-only override that shows NSFW content, but
 *     reverts to whichever durable mode is stored the moment the app is
 *     backgrounded (minimized on iOS/Android) — not just on a full restart.
 *   - 'until-restart': a session-only override that lasts for this process's
 *     lifetime. It survives backgrounding (the JS process is still alive) but
 *     is naturally gone after a cold start, since — like 'until-background' —
 *     nothing is ever written to storage for it; this module reinitializes from
 *     the durable value.
 *
 * Two observables (see `lib/observable.ts`): `durableNsfw$` is the persisted
 * off/on choice; `nsfwMode$` is the live, in-memory mode the UI reads, seeded
 * from the durable value and free to hold a session-only override on top of it.
 */
import { AppState } from 'react-native';
import { observable } from '@legendapp/state';
import { use$ } from '@legendapp/state/react';
import { persisted$ } from '@/lib/observable';

export type NsfwMode = 'off' | 'on' | 'until-background' | 'until-restart';
type DurableNsfwMode = 'off' | 'on';

const DURABLE_KEY = 'comical:nsfwDurable';

const durableNsfw$ = persisted$<DurableNsfwMode>(DURABLE_KEY, 'off');
const nsfwMode$ = observable<NsfwMode>(durableNsfw$.peek());

// The live mode adopts the durable value whenever it changes, which covers the
// async hydrate from disk. User-driven off/on picks also set `nsfwMode$` directly
// in `setNsfwMode`, so this is a no-op for those.
durableNsfw$.onChange(({ value }) => nsfwMode$.set(value));

// A session-only 'until-background' override reverts to the durable mode the
// moment the app is backgrounded. 'until-restart' survives backgrounding (the JS
// process lives on) and is gone naturally after a cold start.
AppState.addEventListener('change', (state) => {
  if (state === 'background' && nsfwMode$.peek() === 'until-background') {
    nsfwMode$.set(durableNsfw$.peek());
  }
});

/** Set the live mode; off/on are also written to disk as the new durable choice. */
function setNsfwMode(mode: NsfwMode): void {
  nsfwMode$.set(mode);
  if (mode === 'off' || mode === 'on') durableNsfw$.set(mode);
}

/** [mode, setMode] — the Settings screen's NSFW picker. */
export function useNsfwMode(): [NsfwMode, (mode: NsfwMode) => void] {
  return [use$(nsfwMode$), setNsfwMode];
}

/** The two session-only overrides, the ones nothing durable is ever written for. */
export type SessionNsfwMode = Extract<NsfwMode, 'until-background' | 'until-restart'>;

/**
 * Flip a SESSION-ONLY override (the Browse bridge-icon hold gesture): hidden → shown for the life
 * of `until`; an active session override of EITHER length → back to the stored durable mode.
 * Nothing durable is ever written. The return value says what happened, so the caller can toast it:
 *  - 'enabled'          — NSFW now visible for this session
 *  - 'reverted'         — the session override was dropped; NSFW is hidden again
 *  - 'already-visible'  — the DURABLE mode already shows NSFW ('on'), so there was nothing to flip
 *
 * `until` was fixed at 'until-background' while the gesture had exactly one meaning: the shorter
 * override is the safer default for something easy to trigger by accident. It is a parameter now
 * that the gesture's action is configurable (see `data/browse-hold-action.ts`) — choosing the
 * longer one in Settings IS the deliberate act that reasoning asked for, rather than a default
 * nobody opted into.
 *
 * Note the 'already-visible' arm: with a durable 'on' this is a NO-OP, because a session gesture
 * must not quietly rewrite a persisted preference. That leaves the hold unable to hide anything
 * while NSFW is durably on — the one state where it can't help. Closing that needs a session-scoped
 * HIDE mode, which does not exist yet; every current override only ever reveals.
 */
export function toggleNsfwSession(until: SessionNsfwMode): 'enabled' | 'reverted' | 'already-visible' {
  const mode = nsfwMode$.peek();
  if (mode === 'off') {
    nsfwMode$.set(until);
    return 'enabled';
  }
  // A live session override of either length drops back to the durable mode.
  if (mode !== 'on') {
    const durable = durableNsfw$.peek();
    nsfwMode$.set(durable);
    return durable === 'off' ? 'reverted' : 'already-visible';
  }
  return 'already-visible';
}

/** True whenever NSFW-flagged bridges/content should stay hidden — every screen
 *  that filters on NSFW (Browse, Library, History, Activity, the Settings
 *  bridge list) reads this instead of caring about the 4 underlying modes. */
export function useHideNsfw(): boolean {
  return use$(nsfwMode$) === 'off';
}
