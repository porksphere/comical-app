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
import { migrateLegacyKey, persisted$ } from '@/lib/observable';

export type NsfwMode = 'off' | 'on' | 'until-background' | 'until-restart';
type DurableNsfwMode = 'off' | 'on';

// JSON-owned key; the old store wrote a bare 'on'/'off' string under
// `comical:nsfwMode`, which we migrate off of once (below).
const DURABLE_KEY = 'comical:nsfwDurable';
const LEGACY_KEY = 'comical:nsfwMode';

const durableNsfw$ = persisted$<DurableNsfwMode>(DURABLE_KEY, 'off');
const nsfwMode$ = observable<NsfwMode>(durableNsfw$.peek());

// The live mode adopts the durable value whenever it changes — which covers the
// async hydrate from disk (the old store's `nsfwMode = durableNsfwMode` on load)
// and the migration below. User-driven off/on picks also set `nsfwMode$`
// directly in `setNsfwMode`, so this is a no-op for those.
durableNsfw$.onChange(({ value }) => nsfwMode$.set(value));

migrateLegacyKey(LEGACY_KEY, durableNsfw$, (raw) => {
  if (durableNsfw$.peek() === 'off') durableNsfw$.set(raw === 'on' ? 'on' : 'off');
});

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

/** True whenever NSFW-flagged bridges/content should stay hidden — every screen
 *  that filters on NSFW (Browse, Library, History, Activity, the Settings
 *  bridge list) reads this instead of caring about the 4 underlying modes. */
export function useHideNsfw(): boolean {
  return use$(nsfwMode$) === 'off';
}
