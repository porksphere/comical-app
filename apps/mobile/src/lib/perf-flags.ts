import { persisted$ } from '@/lib/observable';

/**
 * TEMPORARY perf A/B toggle (2026-07-10). When on, `SeriesCard` skips the two suspected remaining
 * scroll costs: the per-card reanimated cover-aspect "shrink" illusion (its animated styles are left
 * unattached, so no per-frame worklets run per card) and expo-image's cover cross-fade on
 * (re)load. Exposed as a Settings switch so the improvement can be A/B'd in one build — flip it and
 * scroll. Persisted so it survives reloads during testing. Remove once we've decided.
 *
 * Note: the `useSharedValue`/`useAnimatedStyle` hooks are still allocated per card regardless (hooks
 * can't be conditional) — only their per-frame execution is toggled. That's the same limitation the
 * change would ship with anyway, so the delta you feel here is a valid measure of the win.
 */
export const lightCards$ = persisted$('comical:perf-light-cards', true);
