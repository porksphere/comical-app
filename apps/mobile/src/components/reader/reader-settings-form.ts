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
  type SpreadFill,
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
/** The sheet's sections, in the order they are drawn: what a page looks like, how pages turn, the
 *  screen around them, and how they load. Each field names its own, so a setting can't be added
 *  without a place in the sheet, and every renderer groups by the same thing. */
export const READER_SETTINGS_SECTIONS = [
  { id: 'pages', title: 'Pages' },
  { id: 'turning', title: 'Turning' },
  { id: 'screen', title: 'Screen' },
  { id: 'loading', title: 'Loading' },
] as const;
export type ReaderSettingsSectionId = (typeof READER_SETTINGS_SECTIONS)[number]['id'];

export type ReaderSettingsField =
  | {
      kind: 'choice';
      key: string;
      section: ReaderSettingsSectionId;
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
      section: ReaderSettingsSectionId;
      label: string;
      value: boolean;
      onChange: (value: boolean) => void;
      disabled?: boolean;
    }
  | {
      kind: 'stepper';
      key: string;
      section: ReaderSettingsSectionId;
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
      section: 'pages',
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
      section: 'pages',
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
      section: 'turning',
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
      section: 'pages',
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
            section: 'turning',
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
      section: 'pages',
      label: 'Shift spreads by a page',
      value: shift,
      onChange: (v) => {
        if (seriesKey) setSpreadShift(seriesKey, v);
      },
      disabled: !pairing || !seriesKey,
    },
    // Native only: the padding is filled from the pages as published, read from expo-image's disk
    // cache, which the web build doesn't have.
    ...(Platform.OS !== 'web'
      ? [
          choice<SpreadFill>({
            key: 'spread-fill',
            section: 'pages',
            label: 'Spread padding',
            value: settings.spreadFill,
            options: [
              { value: 'off', label: 'Off' },
              { value: 'sides', label: 'Sides' },
              { value: 'middle', label: 'Middle' },
            ],
            onChange: (v) => set({ spreadFill: v }),
            disabled: !pairing,
            hint: !pairing
              ? undefined
              : settings.spreadFill === 'sides'
                ? 'The space either side filled from the pages’ outer edges'
                : settings.spreadFill === 'middle'
                  ? 'The pages at the screen’s edges, the gap between filled from their inner edges'
                  : undefined,
          }),
        ]
      : []),
    {
      kind: 'toggle',
      key: 'keep-awake',
      section: 'screen',
      label: 'Keep screen on',
      value: settings.keepAwake,
      onChange: (v) => set({ keepAwake: v }),
    },
    {
      kind: 'toggle',
      key: 'page-count',
      section: 'screen' as const,
      label: 'Show page count when hidden',
      value: settings.pageCountWhenHidden,
      onChange: (v) => set({ pageCountWhenHidden: v }),
    },
    {
      kind: 'toggle',
      key: 'safe-area',
      section: 'screen' as const,
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
            section: 'loading' as const,
            label: 'Downsample images',
            value: settings.downsample,
            onChange: (v: boolean) => set({ downsample: v }),
          },
        ]
      : []),
    {
      kind: 'stepper',
      key: 'preload-ahead',
      section: 'loading' as const,
      label: 'Preload ahead',
      value: settings.prefetchAhead,
      min: PREFETCH_AHEAD_MIN,
      max: PREFETCH_AHEAD_MAX,
      onChange: (v) => set({ prefetchAhead: v }),
    },
  ];
}

/** The fields under their sections' titles, in section order, the fields' own order within each;
 *  a section with nothing in it now (the web build's) is left out. */
export function readerSettingsSections(
  fields: ReaderSettingsField[],
): { id: ReaderSettingsSectionId; title: string; fields: ReaderSettingsField[] }[] {
  return READER_SETTINGS_SECTIONS.map((section) => ({ ...section, fields: fields.filter((f) => f.section === section.id) })).filter(
    (section) => section.fields.length > 0,
  );
}

/** A choice over a closed set of values, typed at the field and widened for the renderers. */
function choice<T extends string>(field: {
  key: string;
  section: ReaderSettingsSectionId;
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
