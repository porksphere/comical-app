import type { ReactNode } from 'react';

import type * as AppTabs from '@/components/app-tabs';
import type * as AppTabsIos from '@/components/app-tabs.ios';
import type * as FloatOver from '@/components/float-over';
import type * as FloatOverWeb from '@/components/float-over.web';
import type * as OverflowMenu from '@/components/overflow-menu';
import type * as OverflowMenuAndroid from '@/components/overflow-menu.android';
import type * as ImageProgress from '@/components/reader/image-progress';
import type * as ImageProgressWeb from '@/components/reader/image-progress.web';
import type * as IntStepper from '@/components/reader/int-stepper';
import type * as IntStepperAndroid from '@/components/reader/int-stepper.android';
import type * as IntStepperIos from '@/components/reader/int-stepper.ios';
import type * as PagedReader from '@/components/reader/paged-reader';
import type * as PagedReaderWeb from '@/components/reader/paged-reader.web';
import type * as WebtoonReader from '@/components/reader/webtoon-reader';
import type * as WebtoonReaderWeb from '@/components/reader/webtoon-reader.web';
import type * as SeriesCardMenu from '@/components/series-card-menu';
import type * as SeriesCardMenuIos from '@/components/series-card-menu.ios';
import type * as SeriesCardMenuWeb from '@/components/series-card-menu.web';
import type * as PaneActions from '@/components/settings/pane-actions';
import type * as PaneActionsWeb from '@/components/settings/pane-actions.web';
import type * as RangeSlider from '@/components/settings/range-slider';
import type * as RangeSliderAndroid from '@/components/settings/range-slider.android';
import type * as RangeSliderIos from '@/components/settings/range-slider.ios';
import type * as RangeSliderWeb from '@/components/settings/range-slider.web';
import type * as SelectRow from '@/components/settings/select-row';
import type * as SelectRowIos from '@/components/settings/select-row.ios';
import type * as WebLoginSheet from '@/components/settings/web-login-sheet';
import type * as WebLoginSheetWeb from '@/components/settings/web-login-sheet.web';
import type * as SplashGate from '@/components/splash-gate';
import type * as SplashGateWeb from '@/components/splash-gate.web';
import type * as BackupFile from '@/data/backup-file';
import type * as BackupFileWeb from '@/data/backup-file.web';
import type * as Startup from '@/data/embedded/startup';
import type * as StartupWeb from '@/data/embedded/startup.web';
import type * as UseColorScheme from '@/hooks/use-color-scheme';
import type * as UseColorSchemeWeb from '@/hooks/use-color-scheme.web';
import type * as UseKeyboardLift from '@/hooks/use-keyboard-lift';
import type * as UseKeyboardLiftWeb from '@/hooks/use-keyboard-lift.web';
import type * as ScrubHaptics from '@/lib/scrub-haptics';
import type * as ScrubHapticsWeb from '@/lib/scrub-haptics.web';

/**
 * Every platform file checked against its base. Call sites only ever see the base (tsconfig has no
 * `moduleSuffixes`), so without this a `.ios`/`.android`/`.web` file can drop an export, change its
 * type, or never learn about a prop the base gained, and still compile. Type-only and imported by
 * nothing, so it never reaches a bundle.
 *
 * A platform file that declares its own props must take the same names as the base, or name the
 * ones it deliberately doesn't take in its line below: the list of what a platform goes without.
 * One that takes the base's own props type passes by construction. A new platform file gets a line.
 */

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

type Fn = (...args: never[]) => unknown;

type FirstParam<F> = F extends (first: infer P, ...rest: never[]) => unknown ? P : never;

// Components return what they like: only a hook's or helper's return is part of its contract.
type ReturnsMatch<B extends Fn, I extends Fn> = [ReturnType<I>] extends [ReturnType<B>]
  ? true
  : [ReturnType<I>, ReturnType<B>] extends [ReactNode, ReactNode]
    ? true
    : false;

type ExportDrift<B, I, Skipped> = [B] extends [Fn]
  ? [I] extends [Fn]
    ? [Parameters<B>] extends [Parameters<I>]
      ? [Extract<Skipped, keyof FirstParam<I>>] extends [never]
        ? [Exclude<Skipped, keyof FirstParam<B>>] extends [never]
          ? Same<Exclude<keyof FirstParam<B>, Skipped>, keyof FirstParam<I>> extends true
            ? ReturnsMatch<B, I> extends true
              ? never
              : 'return type differs from the base'
            : 'prop names differ from the base: take the new ones, or list them as skipped'
          : 'skips a prop the base no longer has'
        : 'skips a prop it takes'
      : 'does not accept what the base accepts'
    : 'a function in the base'
  : [I] extends [B]
    ? never
    : 'type differs from the base';

type Drift<Base, Impl, Skipped extends string = never> = {
  [K in keyof Base | keyof Impl as K extends keyof Base
    ? K extends keyof Impl
      ? [ExportDrift<Base[K], Impl[K], Skipped>] extends [never]
        ? never
        : K
      : K
    : K]: K extends keyof Base
    ? K extends keyof Impl
      ? ExportDrift<Base[K], Impl[K], Skipped>
      : 'missing on this platform'
    : 'not exported by the base';
};

type Conforms<T extends Record<string, never>> = T;

export type PlatformContracts = [
  Conforms<Drift<typeof AppTabs, typeof AppTabsIos>>,
  Conforms<Drift<typeof FloatOver, typeof FloatOverWeb>>,
  Conforms<Drift<typeof OverflowMenu, typeof OverflowMenuAndroid>>,
  Conforms<Drift<typeof ImageProgress, typeof ImageProgressWeb>>,
  Conforms<Drift<typeof IntStepper, typeof IntStepperAndroid>>,
  Conforms<Drift<typeof IntStepper, typeof IntStepperIos>>,
  // Web has no continuous scrubber (the progress pill jumps) and no poster for the list to end
  // (see reader-pane). It zooms the page itself and never says so, so on a touch browser the
  // reader's swipe-down stays armed while a page is zoomed.
  Conforms<
    Drift<
      typeof PagedReader,
      typeof PagedReaderWeb,
      'scrubTarget' | 'scrubbing' | 'onReady' | 'onDragBegin' | 'onZoomChange'
    >
  >,
  // As the pager, and web's list joins the next or previous chapter as it scrolls, so it has no
  // end-of-chapter sentinel or pull-back. Sizes only feed the poster and paged-mode detection.
  Conforms<
    Drift<
      typeof WebtoonReader,
      typeof WebtoonReaderWeb,
      | 'onReady'
      | 'onDragBegin'
      | 'onZoomChange'
      | 'onPageSize'
      | 'onEndReached'
      | 'nextChapterName'
      | 'onAdvance'
      | 'onGoBack'
    >
  >,
  Conforms<Drift<typeof SeriesCardMenu, typeof SeriesCardMenuIos>>,
  Conforms<Drift<typeof SeriesCardMenu, typeof SeriesCardMenuWeb>>,
  Conforms<Drift<typeof PaneActions, typeof PaneActionsWeb>>,
  Conforms<Drift<typeof RangeSlider, typeof RangeSliderAndroid>>,
  Conforms<Drift<typeof RangeSlider, typeof RangeSliderIos>>,
  Conforms<Drift<typeof RangeSlider, typeof RangeSliderWeb>>,
  Conforms<Drift<typeof SelectRow, typeof SelectRowIos>>,
  Conforms<Drift<typeof WebLoginSheet, typeof WebLoginSheetWeb>>,
  Conforms<Drift<typeof SplashGate, typeof SplashGateWeb>>,
  Conforms<Drift<typeof BackupFile, typeof BackupFileWeb>>,
  Conforms<Drift<typeof Startup, typeof StartupWeb>>,
  Conforms<Drift<typeof UseColorScheme, typeof UseColorSchemeWeb>>,
  Conforms<Drift<typeof UseKeyboardLift, typeof UseKeyboardLiftWeb>>,
  Conforms<Drift<typeof ScrubHaptics, typeof ScrubHapticsWeb>>,
];
