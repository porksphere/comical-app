import { use$ } from '@legendapp/state/react';

import { toggleNsfwSession } from '@/data/nsfw';
import { persisted$ } from '@/lib/observable';

/**
 * What the Browse bridge-icon HOLD does — the hidden, unlabelled gesture on the top-left identity
 * mark (`useRampedHold`: three escalating haptic beats, then one commit; a plain tap does nothing).
 *
 * The gesture is a binary trigger with deliberate friction, so what it can usefully carry is
 * narrow: something consequential enough to deserve a second and a half of holding, and something
 * you want reachable WITHOUT navigating — which is why this list is NSFW visibility and nothing
 * else. A shortcut to a settings page doesn't want haptic friction, it wants a tap; and mixing
 * unrelated actions here would cost the ramp its one real property, which is that you know what is
 * about to happen before it commits.
 *
 * 'none' is the point of the setting as much as the alternatives are: the gesture is undiscoverable
 * and sits on a control in the corner you reach for constantly, and until now there was no way to
 * turn it off. This screen is also the only place it is documented.
 */
export type BrowseHoldAction = 'none' | 'nsfw-until-closed' | 'nsfw-until-restart';

const holdAction$ = persisted$<BrowseHoldAction>('comical:browseHoldAction', 'nsfw-until-closed');

export function useBrowseHoldAction(): [BrowseHoldAction, (action: BrowseHoldAction) => void] {
  return [use$(holdAction$), (next) => holdAction$.set(next)];
}

/**
 * Run the configured action and return what to toast, or null if there is nothing to say.
 *
 * The wording is the ACTION's rather than the caller's, so the toast can never describe a different
 * override from the one that just ran — the gesture's only confirmation is this line, since nothing
 * on screen announces what the hold is bound to.
 */
export function runBrowseHoldAction(): string | null {
  const action = holdAction$.peek();
  if (action === 'none') return null;
  const until = action === 'nsfw-until-restart' ? 'until-restart' : 'until-background';
  const result = toggleNsfwSession(until);
  if (result === 'reverted') return 'NSFW hidden again';
  if (result === 'already-visible') return 'NSFW is already enabled in Settings';
  return until === 'until-restart' ? 'NSFW enabled until the app restarts' : 'NSFW enabled until the app is closed';
}
