import { Platform, useWindowDimensions } from 'react-native';

import { readsDouble } from '@/components/reader/spreads';
import {
  PREFETCH_AHEAD_MAX,
  PREFETCH_AHEAD_MIN,
  setSpreadShift,
  useReaderSettings,
  useSpreadShift,
  type DoubleTapMode,
  type PageFit,
  type PageLayout,
  type PageTurn,
  type ReaderDirection,
} from '@/hooks/use-reader-settings';
import { useIsDesktop } from '@/hooks/use-responsive';

/**
 * The reader's settings sheet as data: what it holds, in order, with each field's value, its
 * choices, whether it can be changed right now, the note under it, and what a change sets. The
 * ONE place a setting is added. Two renderers draw it — the custom panel in the shared overlay
 * (`settings-panel.tsx`, Android and web) and a SwiftUI form in a system sheet
 * (`settings-panel.ios.tsx`) — each with a switch over `kind` that the typecheck requires to be
 * complete, so a new kind of field fails until both can draw it, and a new field of a kind they
 * know appears on every platform at once. Nothing here is a view: no component, no style, no
 * platform's control.
 *
 * `key` names the field to tests, under `reader.settings.`: a choice's options append their value.
 */
export type ReaderSettingsField =
  | {
      kind: 'choice';
      key: string;
      label: string;
      value: string;
      options: readonly { value: string; label: string }[];
      onChange: (value: string) => void;
      disabled?: boolean;
      /** A line under the control explaining the current choice. */
      hint?: string;
    }
  | {
      kind: 'toggle';
      key: string;
      label: string;
      value: boolean;
      onChange: (value: boolean) => void;
      disabled?: boolean;
    }
  | {
      kind: 'stepper';
      key: string;
      label: string;
      value: number;
      min: number;
      max: number;
      onChange: (value: number) => void;
    };

export function useReaderSettingsForm(seriesKey: string | null): ReaderSettingsField[] {
  const [settings, set] = useReaderSettings(seriesKey);
  const shift = useSpreadShift(seriesKey);
  // The window stands in for the reader's frame, which is the window less any safe-area inset —
  // close enough to say whether `auto` is pairing right now.
  const window = useWindowDimensions();
  // A desktop window has no orientation to speak of; it is nearly always wider than tall.
  const desktop = useIsDesktop();
  const paged = settings.mode === 'paged';
  const webtoon = settings.mode === 'webtoon';
  const pairing = paged && readsDouble(settings.pageLayout, window);
  return [
    // Mode (Paged/Webtoon) and direction (L→R/R→L) as one 3-way choice: reading direction is one
    // decision, not two settings. Vertical touches only `mode`, so `direction` is kept for the way
    // back (unread while webtoon).
    choice<'ltr' | 'vertical' | 'rtl'>({
      key: 'direction',
      label: 'Reading direction',
      value: webtoon ? 'vertical' : settings.direction,
      options: [
        { value: 'ltr', label: 'L → R' },
        { value: 'vertical', label: 'Vertical' },
        { value: 'rtl', label: 'R → L' },
      ],
      onChange: (v) =>
        v === 'vertical' ? set({ mode: 'webtoon' }) : set({ mode: 'paged', direction: v as ReaderDirection }),
    }),
    choice<PageFit>({
      key: 'page-fit',
      label: 'Page fit',
      // Webtoon has only the two layouts (one page per screen, or a continuous strip), so it shows
      // two and reads `auto` as the page — the same mapping WebtoonReader applies.
      value: webtoon ? (webtoonFit(settings.pageFit) === 'fit-page' ? 'fit-height' : 'fit-width') : settings.pageFit,
      options: [
        ...(paged ? [{ value: 'auto' as const, label: 'Auto' }] : []),
        { value: 'fit-width', label: 'Fit width' },
        { value: 'fit-height', label: 'Fit height' },
      ],
      onChange: (v) => set({ pageFit: v }),
      hint: webtoon
        ? webtoonFit(settings.pageFit) === 'fit-page'
          ? 'One page at a time, like Paged'
          : 'Continuous scroll'
        : undefined,
    }),
    choice<DoubleTapMode>({
      key: 'double-tap',
      label: 'Double-tap',
      value: settings.doubleTap,
      options: [
        { value: 'magnify', label: 'Magnify' },
        { value: 'switch-fit', label: 'Switch fit' },
        { value: 'off', label: 'Off' },
      ],
      onChange: (v) => set({ doubleTap: v }),
    }),
    choice<PageLayout>({
      key: 'page-layout',
      label: 'Page layout',
      value: settings.pageLayout,
      options: [
        { value: 'single', label: 'Single' },
        { value: 'double', label: 'Double' },
        { value: 'auto', label: 'Auto' },
      ],
      onChange: (v) => set({ pageLayout: v }),
      disabled: !paged,
      hint:
        paged && settings.pageLayout === 'auto'
          ? desktop
            ? 'Two pages side by side when the window is wider than tall'
            : 'Two pages side by side in landscape'
          : undefined,
    }),
    // The curl is drawn by Skia from pictures of the pages on screen, which the web build can't take.
    ...(Platform.OS !== 'web'
      ? [
          choice<PageTurn>({
            key: 'page-turn',
            label: 'Page turn',
            value: settings.pageTurn,
            options: [
              { value: 'slide', label: 'Slide' },
              { value: 'curl', label: 'Curl' },
            ],
            onChange: (v) => set({ pageTurn: v }),
            disabled: !paged,
          }),
        ]
      : []),
    {
      kind: 'toggle',
      key: 'spread-shift',
      label: 'Shift spreads by a page',
      value: shift,
      onChange: (v) => {
        if (seriesKey) setSpreadShift(seriesKey, v);
      },
      disabled: !pairing || !seriesKey,
    },
    { kind: 'toggle', key: 'keep-awake', label: 'Keep screen on', value: settings.keepAwake, onChange: (v) => set({ keepAwake: v }) },
    {
      kind: 'toggle',
      key: 'page-count',
      label: 'Show page count when hidden',
      value: settings.pageCountWhenHidden,
      onChange: (v) => set({ pageCountWhenHidden: v }),
    },
    {
      kind: 'toggle',
      key: 'safe-area',
      label: 'Respect safe areas',
      value: settings.respectSafeArea,
      onChange: (v) => set({ respectSafeArea: v }),
    },
    // The web image ignores `allowDownscaling` — the browser decodes an <img> its own way.
    ...(Platform.OS !== 'web'
      ? [
          {
            kind: 'toggle' as const,
            key: 'downsample',
            label: 'Downsample images',
            value: settings.downsample,
            onChange: (v: boolean) => set({ downsample: v }),
          },
        ]
      : []),
    {
      kind: 'stepper',
      key: 'preload-ahead',
      label: 'Preload ahead',
      value: settings.prefetchAhead,
      min: PREFETCH_AHEAD_MIN,
      max: PREFETCH_AHEAD_MAX,
      onChange: (v) => set({ prefetchAhead: v }),
    },
  ];
}

/** A choice over a closed set of values, typed at the field and widened for the renderers. */
function choice<T extends string>(field: {
  key: string;
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  hint?: string;
}): ReaderSettingsField {
  return { kind: 'choice', ...field, onChange: (v) => field.onChange(v as T) };
}

/** The layout webtoon gives a page fit — see `PageFit`: one page per screen, or the strip. */
export function webtoonFit(fit: PageFit): 'fit-page' | 'fit-width' {
  return fit === 'fit-width' ? 'fit-width' : 'fit-page';
}
