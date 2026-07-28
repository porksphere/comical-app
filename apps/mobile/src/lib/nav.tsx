import { Link as ExpoLink, router as expoRouter, useRouter as useExpoRouter } from 'expo-router';
import type { ComponentProps } from 'react';

import { BACK_TARGET, claimNavigation, navTargetKey } from '@/lib/nav-guard';

/**
 * The app's navigation entry points — expo-router's, wrapped so a duplicate navigation from a
 * double tap is dropped. **Import `useRouter`, `router` and `Link` from here, never from
 * `expo-router` directly** (enforced by the `comical/no-unguarded-nav` lint rule).
 *
 * Why this exists at all — and why the guard is time-based rather than state-based — is in
 * `nav-guard.ts`; this module only wires that decision to the two ways the app navigates:
 * the imperative router (every screen) and the `<Link>` anchor (the series card on web, and
 * ExternalLink). Both share ONE guard, so a card that is a `<Link>` on web and an imperative
 * `router.push` on native can't double-fire through the seam either.
 *
 * Only the operations that CHANGE the stack are guarded — `push`/`navigate`/`replace`/
 * `dismissTo` by destination, `back`/`dismiss`/`dismissAll` as one shared "go back" target.
 * `setParams`, `prefetch`, `reload` and the `can*` predicates pass straight through: they're
 * either idempotent or not navigation at all, and guarding them would only break callers.
 */

type Router = ReturnType<typeof useExpoRouter>;

/**
 * Guarded views are cached per underlying router object so the wrapper has a STABLE identity —
 * `router` sits in plenty of `useCallback`/`useMemo` dependency arrays, and a fresh object per
 * render would invalidate every one of them. (expo-router hands out one of two singletons: the
 * real router, or a warn-only one inside a link preview — hence a map rather than a constant.)
 */
const guarded = new WeakMap<Router, Router>();

function guard(base: Router): Router {
  const existing = guarded.get(base);
  if (existing) return existing;
  const wrapper: Router = {
    ...base,
    push: (href, options) => {
      if (claimNavigation(navTargetKey(href))) base.push(href, options);
    },
    navigate: (href, options) => {
      if (claimNavigation(navTargetKey(href))) base.navigate(href, options);
    },
    replace: (href, options) => {
      if (claimNavigation(navTargetKey(href))) base.replace(href, options);
    },
    dismissTo: (href, options) => {
      if (claimNavigation(navTargetKey(href))) base.dismissTo(href, options);
    },
    back: () => {
      if (claimNavigation(BACK_TARGET)) base.back();
    },
    dismiss: (count) => {
      if (claimNavigation(BACK_TARGET)) base.dismiss(count);
    },
    dismissAll: () => {
      if (claimNavigation(BACK_TARGET)) base.dismissAll();
    },
  };
  guarded.set(base, wrapper);
  return wrapper;
}

/** Guarded drop-in for expo-router's `useRouter()`. */
export function useRouter(): Router {
  return guard(useExpoRouter());
}

/** Guarded drop-in for expo-router's `router` singleton (for call sites outside a component). */
export const router: Router = guard(expoRouter);

type LinkProps = ComponentProps<typeof ExpoLink>;
type LinkPressEvent = Parameters<NonNullable<LinkProps['onPress']>>[0];

/**
 * Guarded drop-in for expo-router's `<Link>`. A rejected press is `preventDefault()`ed, which
 * expo-router reads (`shouldHandleMouseEvent`) as "already handled" and skips its own
 * navigation — the same call that stops the browser following the underlying `<a href>` on web,
 * so neither route changes. The wrapped `onPress` is skipped too, since a link that does its own
 * work on press (ExternalLink opening the in-app browser) must not do it twice either.
 */
export function Link({ onPress, ...rest }: LinkProps) {
  const handlePress = (event: LinkPressEvent) => {
    if (!claimNavigation(navTargetKey(rest.href))) {
      event.preventDefault();
      return;
    }
    onPress?.(event);
  };
  // eslint-disable-next-line comical/require-test-id -- pass-through wrapper: the testID comes from the call site's props.
  return <ExpoLink {...rest} onPress={handlePress} />;
}
