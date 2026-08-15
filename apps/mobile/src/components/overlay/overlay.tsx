import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
  type RefObject,
} from 'react';
import { Platform, Pressable, StyleSheet, useWindowDimensions, View, type TextInput } from 'react-native';
import { Gesture, GestureDetector, ScrollView as GHScrollView } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedKeyboard,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { RowHeight, Spacing } from '@/constants/theme';
import { useIsLargeScreen } from '@/hooks/use-responsive';
import { useTheme } from '@/hooks/use-theme';
import { sharedPushback } from '@/lib/pushback-signal';
import { armSettleCheck, cancelSettleCheck, notePushback, reportStuck } from '@/lib/pushback-watchdog';

// A small stacked-overlay system. On phones (and mobile web / iOS) each overlay
// is a bottom sheet with a drag handle (swipe down to dismiss); opening a new
// one pushes the one below it back (scale + lift + dim). On wide desktop
// viewports (≥768px) the same content is instead presented as an anchored
// popover that drops in next to the trigger that opened it. Works on iOS,
// Android and web (reanimated + gesture-handler).

/** On-screen rectangle of the trigger that opened an overlay, in window
 *  coordinates (from `measureInWindow`). Used to position the desktop popover. */
export type AnchorRect = { x: number; y: number; width: number; height: number };

type OverlayApi = {
  /** Returns the id assigned to the opened item — compare against `topId` to
   *  tell whether that specific overlay is still the (single) topmost one.
   *  `opts.popover` forces the anchored-popover presentation even on phones
   *  (context menus float at the press point instead of rising as a sheet);
   *  it needs an `anchor` to mean anything. */
  open: (render: () => ReactNode, anchor?: AnchorRect | null, opts?: { popover?: boolean }) => number;
  closeTop: () => void;
  /** Id of the topmost open item, or null when the stack is empty. */
  topId: number | null;
};

const OverlayContext = createContext<OverlayApi | null>(null);

export function useOverlay(): OverlayApi {
  const ctx = useContext(OverlayContext);
  if (!ctx) throw new Error('useOverlay must be used within an OverlayProvider');
  return ctx;
}

/**
 * Opens an overlay anchored to its trigger: attach the returned `ref` to the
 * trigger (a `Pressable`/`View`) and call `openAt(render)` on press. It measures
 * the trigger's on-screen rect and hands it to `open`, so the desktop popover
 * can position itself next to the trigger. On phones the rect is ignored and the
 * bottom sheet is shown as before. Falls back to a plain `open` if the ref isn't
 * measurable yet.
 *
 * Also makes the trigger a toggle: pressing it again while its own overlay is
 * still the topmost one closes it instead of pushing a second copy on top of
 * itself. Opening a *different* trigger's overlay while this one is open is
 * unaffected — that still pushes as before (the stacked-overlay behavior).
 */
export function useAnchoredOverlay() {
  const { open, closeTop, topId } = useOverlay();
  const ref = useRef<View>(null);
  // The id of the overlay THIS trigger opened. State, not a ref: `isOpen` is derived from it during
  // render, and a ref read during render isn't tracked by React (nor allowed — react-hooks/refs), so
  // the toggle could paint stale. As state, the write that records the id is itself what re-renders,
  // and `openAt` closes over a value from the same render as the `topId` it compares against.
  const [myId, setMyId] = useState<number | null>(null);
  const isOpen = myId !== null && myId === topId;
  const openAt = useCallback(
    (render: () => ReactNode) => {
      if (myId !== null && myId === topId) {
        closeTop();
        return;
      }
      const node = ref.current;
      if (node && typeof node.measureInWindow === 'function') {
        node.measureInWindow((x, y, width, height) => {
          setMyId(open(render, { x, y, width, height }));
        });
      } else {
        setMyId(open(render));
      }
    },
    [open, closeTop, topId, myId],
  );
  return { ref, openAt, isOpen };
}

// Lets a scrollable inside a sheet hand its scroll to the sheet's drag-to-
// dismiss: it reports its vertical offset (so the sheet only takes over a
// downward drag once the list is at the top) and registers its ref so the
// sheet's pan can run simultaneously with the list's own scroll.
type SheetScroll = {
  scrollRef: RefObject<ComponentType | null>;
  scrollOffset: SharedValue<number>;
};

const SheetScrollContext = createContext<SheetScroll | null>(null);

/** Available to content rendered inside an overlay sheet; null elsewhere. */
export function useSheetScroll(): SheetScroll | null {
  return useContext(SheetScrollContext);
}

// Lets a focused TextInput inside a sheet report its own on-screen bottom edge,
// so the sheet can shift itself just enough to clear the keyboard instead of
// shifting (or not shifting) as a whole regardless of where the input sits.
type SheetKeyboard = {
  reportFocus: (bottomY: number) => void;
  reportBlur: () => void;
};

const SheetKeyboardContext = createContext<SheetKeyboard | null>(null);

/**
 * Wires a `TextInput` into its enclosing sheet's keyboard-avoidance. Pass the
 * input's own ref (whatever the call site already has, or a new one) to
 * `onFocus`/`onBlur` — no ref-merging needed. No-op outside a sheet (desktop
 * popover, or no overlay at all).
 */
export function useKeyboardAvoidingInput() {
  const ctx = useContext(SheetKeyboardContext);
  return useMemo(
    () => ({
      onFocus: (node: Pick<TextInput, 'measureInWindow'> | null) => {
        node?.measureInWindow((_x, y, _w, h) => ctx?.reportFocus(y + h));
      },
      onBlur: () => ctx?.reportBlur(),
    }),
    [ctx],
  );
}

// How the current overlay content is being presented: the mobile bottom sheet or
// the desktop anchored popover. Lets shared interior bits (e.g. the heading)
// adapt without each call site knowing which container wraps it.
type OverlayPresentation = 'sheet' | 'popover';
const OverlayPresentationContext = createContext<OverlayPresentation>('sheet');

/** Whether overlay content is shown as the mobile sheet or the desktop popover. */
export function useOverlayPresentation(): OverlayPresentation {
  return useContext(OverlayPresentationContext);
}

// Per-overlay real-number budget for the header+list content (see the note
// above `ROW_UNIT_HEIGHT`): `budget` is the actual space `OverlaySheet`/
// `OverlayPopover` computed from the window/anchor (never content-derived),
// and `headerHeight` is whatever `MeasuredHeader` last measured itself at —
// together they let `OptionList` size itself to a real number instead of a
// `flexGrow` chain.
type SheetBudget = { budget: number; headerHeight: number; setHeaderHeight: (h: number) => void };
const SheetBudgetContext = createContext<SheetBudget | null>(null);

// Lets `OptionList` report whether its content needs an internal scroll back up
// to the enclosing `OverlaySheet`, which uses that to decide whether to reserve
// the bottom safe-area inset below the sheet's content (see the note above
// `OverlaySheet`'s `styles.sheet`). Only the sheet provides this — the popover
// has no device-chrome inset of its own to reserve, so it's `null` (a no-op)
// there.
type ReportNeedsScroll = (needsScroll: boolean) => void;
const SheetContentScrollContext = createContext<ReportNeedsScroll | null>(null);

/**
 * The heading for overlay content — the single place overlay titles live, shared
 * by every editor / menu / sheet. Rendered on the mobile sheet; hidden in the
 * desktop popover, which is anchored to the trigger that already names it.
 */
export function OverlayHeading({ children }: { children: string }) {
  if (useOverlayPresentation() === 'popover') return null;
  return (
    <ThemedText type="subtitle" style={styles.heading}>
      {children}
    </ThemedText>
  );
}

const AnimatedScrollView = Animated.createAnimatedComponent(GHScrollView);

// The sheet/popover's outer box is capped to whatever room it actually has
// (window height for the sheet, the anchor-clamped space for the popover —
// see `OverlaySheet`/`OverlayPopover` below). `OptionList` needs to fill
// whatever's left after its sibling `MeasuredHeader`, but it can't do that
// with `flexGrow` the way it would on plain web flexbox: that outer box only
// has a `maxHeight` cap, not a definite `height`, and a `flexGrow` ScrollView
// nested under an ancestor whose own size is merely capped (rather than
// definite) resolves to ~0 height on iOS/Android — Yoga has no definite size
// to grow into there, even though browsers (react-native-web) handle exactly
// this case fine, which is why a `flexGrow`-based version of this only ever
// broke on native. So instead `MeasuredHeader` reports its own rendered
// height into `SheetBudgetContext` (set up per-overlay by
// `OverlaySheet`/`OverlayPopover`), and `OptionList` computes its own
// explicit `maxHeight`/`height` from that real budget minus the header — a
// genuine number on every platform, not a flex chain that only resolves on
// some of them.
//
// 7 whole rows (a `row`'s standardized `RowHeight`, plus its list's own
// inter-row gap) covers ordinary lists (a handful of genres/tags/bridges)
// before an internal scroll kicks in; longer ones still scroll — they're well
// past any reasonable cap.
const ROW_UNIT_HEIGHT = RowHeight + Spacing.two;
// Trailing space *inside* the scrollable list's own content, after the last
// row — part of `listContent` below, not a separately-painted view and not
// outer margin on the sheet (that either paints a bar-shaped block in the
// panel's own fill or, worse, exposes the dimmed backdrop as a stripe below
// the sheet — both tried and rejected). This just gives the content itself a
// bit more height, so the last row isn't flush against the sheet's own
// bottom edge (or, for a short list, against the screen).
const LIST_TRAILING_SPACE = Spacing.four;
// `+ Spacing.one + LIST_TRAILING_SPACE` reserves room for `listContent`'s own
// paddingTop/paddingBottom (above): those live *inside* this same capped
// viewport, so without adding them here the 7th row's bottom few pixels (and
// everything after it) get clipped instead of the viewport stopping cleanly
// after a whole row — the list cuts off mid-row with what reads as a blank
// gap underneath, rather than reaching that gap only after a complete row.
const LIST_MAX_HEIGHT = ROW_UNIT_HEIGHT * 7 - Spacing.two + Spacing.one + LIST_TRAILING_SPACE;
// Floor so a not-yet-measured header (the first frame, before its own
// `onLayout` has fired) doesn't leave the list with zero/negative room.
const LIST_MIN_HEIGHT = 160;
// Matches this file's own `handleArea` (paddingTop + handle height + paddingBottom).
const HANDLE_AREA_HEIGHT = Spacing.two + 5 + Spacing.three;
// Gap between a `MeasuredHeader` and the `OptionList` below it — owned by
// each caller's own wrapper (`selector.tsx`'s `menu`, `filter-editors.tsx`'s
// `body`), not by this file, but both use the same value.
const HEADER_TO_LIST_GAP = Spacing.three;

/** Wraps a sheet's non-list content (title, helper text, search input, …). */
export function MeasuredHeader({ children }: { children: ReactNode }) {
  const presentation = useOverlayPresentation();
  const budget = useContext(SheetBudgetContext);
  return (
    <View
      style={presentation === 'popover' ? listStyles.headerPopover : listStyles.header}
      onLayout={budget ? (e) => budget.setHeaderHeight(e.nativeEvent.layout.height) : undefined}>
      {children}
    </View>
  );
}

/** Caps long option lists with an internal scroll so the sheet stays usable.
 * Fills whatever `SheetBudgetContext` reports is left after its sibling
 * `MeasuredHeader` (see the comment above `ROW_UNIT_HEIGHT`), up to a
 * `LIST_MAX_HEIGHT` ceiling so a short sheet doesn't balloon just because the
 * screen has room. `fixed` instead gives it that same computed height as a
 * constant preferred height (so the sheet doesn't resize while searching)
 * that still shrinks (`flexShrink: 1`) if the container doesn't have that
 * much room.
 *
 * Reports its scroll offset to the enclosing overlay sheet (and registers its
 * ref) so a downward drag at the top of the list chains into dismissing the
 * sheet. A gesture-handler ScrollView lets that drag run simultaneously with
 * this list's own scroll.
 *
 * Below the last row, both the gaps between rows and the sheet's own
 * trailing safe-area padding read as the sheet's own panel color — the same
 * color, so no spacer/bleed view is needed here. An earlier version painted
 * a separate block in this gap to patch a suspected seam; because that block
 * was `pointerEvents: 'none'`, pixel probes done via `elementFromPoint` never
 * saw it (that API skips non-interactive elements), so it shipped even
 * though it was clearly visible on screen. Screenshots (not DOM color
 * probing) are what caught it.
 *
 * `LIST_TRAILING_SPACE` only applies on the sheet: the popover's outer
 * `paddingVertical` (see `styles.popover`) already clears its own bottom edge
 * symmetrically with the top, so adding the sheet's trailing space there too
 * would double up into a bottom gap nearly twice the top one.
 *
 * On the popover specifically (which has no vertical padding of its own),
 * this also decides whether the *list* should have top/bottom padding
 * matching its horizontal padding: only when its rows comfortably fit
 * without scrolling. Once there's enough content to need an internal
 * scroll, that padding goes away entirely (rows run flush to the border).
 * Content height is measured via an inner wrapper that isn't itself
 * padded, so the measurement can't be thrown off by the padding decision
 * it's used to make; padding is tried once when there's room and reverted
 * if that push turns out to tip it into scrolling — a settle that takes at
 * most one flip, never an ongoing back-and-forth.
 *
 * That same fits-without-scrolling signal is measured on the sheet too (not
 * just the popover) and reported up through `SheetContentScrollContext` —
 * `OverlaySheet` uses it to decide whether to reserve the bottom safe-area
 * inset below its content, mirroring the popover's fits→padded chrome. */
export function OptionList({ children, fixed }: { children: ReactNode; fixed?: boolean }) {
  const sheet = useSheetScroll();
  const presentation = useOverlayPresentation();
  const budget = useContext(SheetBudgetContext);
  const target = budget
    ? Math.max(LIST_MIN_HEIGHT, Math.min(LIST_MAX_HEIGHT, budget.budget - budget.headerHeight - HEADER_TO_LIST_GAP))
    : LIST_MAX_HEIGHT;
  const localOffset = useSharedValue(0);
  const offset = sheet?.scrollOffset ?? localOffset;
  const onScroll = useAnimatedScrollHandler((e) => {
    offset.set(e.contentOffset.y);
  });

  const [needsScroll, setNeedsScroll] = useState(true);
  const needsScrollRef = useRef(needsScroll);
  const coreHeightRef = useRef(0);
  const scrollHeightRef = useRef(0);
  const triedPadded = useRef(false);

  // Sheet-only: forward the same fits/needs-scroll verdict up to `OverlaySheet`
  // (a no-op on the popover, which doesn't provide this context). Reported
  // from inside `evaluate` itself (below), not a `useEffect` keyed on
  // `needsScroll` — an effect fires after every render including the very
  // first, before any real layout has happened, and would report the
  // pre-measurement default guess. `evaluate` only ever runs off a real
  // onLayout event, so its report is always backed by an actual measurement.
  // It reports unconditionally (not just on change) so a list that's clamped
  // from its very first evaluation — which never takes the "flip" branches
  // below — still gets its `true` verdict sent up at least once.
  const reportNeedsScroll = useContext(SheetContentScrollContext);

  // Decided imperatively off each fresh onLayout event rather than through a
  // useEffect keyed on `needsScroll`: an effect re-running the instant
  // `needsScroll` flips would read the *previous* render's scroll height (the
  // new padding's own layout pass hasn't happened yet), always concluding
  // "still clamped" and reverting on the spot. Reading straight from the
  // event — which only ever fires once that render's real layout is in —
  // avoids that stale-state race entirely. Both onLayout callbacks (the
  // scroll frame and the inner unpadded row wrapper) can fire in either
  // order, so either one re-evaluates using whatever the other last reported.
  const evaluate = useCallback(() => {
    const coreHeight = coreHeightRef.current;
    const scrollHeight = scrollHeightRef.current;
    if (coreHeight === 0 || scrollHeight === 0) return;
    if (needsScrollRef.current) {
      // Flush right now. An unclamped ScrollView auto-sizes down to exactly
      // its content's height (it doesn't hold slack in reserve), so "not
      // clamped" reads as scrollHeight ≈ coreHeight — that's the signal
      // there's room to try adding padding, not scrollHeight already being
      // bigger than coreHeight.
      if (!triedPadded.current && scrollHeight >= coreHeight - 0.5) {
        triedPadded.current = true;
        needsScrollRef.current = false;
        setNeedsScroll(false);
      }
    } else if (scrollHeight < coreHeight + Spacing.four * 2 - 0.5) {
      // Padded right now — if that push clamped it after all, revert.
      needsScrollRef.current = true;
      setNeedsScroll(true);
    }
    reportNeedsScroll?.(needsScrollRef.current);
  }, [reportNeedsScroll]);

  const popoverPadded = presentation === 'popover' && !needsScroll;

  return (
    <AnimatedScrollView
      ref={sheet?.scrollRef as never}
      onScroll={onScroll}
      scrollEventThrottle={16}
      onLayout={(e) => {
        scrollHeightRef.current = e.nativeEvent.layout.height;
        evaluate();
      }}
      style={
        fixed
          ? { height: target, flexShrink: 1, minHeight: 0 }
          : { maxHeight: target, flexShrink: 1, minHeight: 0 }
      }
      contentContainerStyle={
        presentation === 'popover'
          ? [listStyles.listContentPopover, popoverPadded && listStyles.listContentPopoverPadded]
          : listStyles.listContent
      }
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}>
      <View
        style={listStyles.rowsWrapper}
        onLayout={(e) => {
          coreHeightRef.current = e.nativeEvent.layout.height;
          evaluate();
        }}>
        {children}
      </View>
    </AnimatedScrollView>
  );
}

const listStyles = StyleSheet.create({
  header: {
    gap: Spacing.three,
  },
  // The popover no longer has its own paddingVertical (see `styles.popover`),
  // so a header that does render on the popover (TriEditor/TagSearchEditor's
  // helper text, search input) needs its own top clearance from the border.
  headerPopover: {
    gap: Spacing.three,
    paddingTop: Spacing.four,
  },
  listContent: {
    // `gap` lives on `rowsWrapper` instead (below): both presentations wrap
    // rows in that inner measuring View now, so this contentContainerStyle
    // only ever has that one child — a `gap` here would be a no-op.
    // A little room at the top too, so a scrolled-to-top list doesn't sit the
    // first row flush against the list's own top edge (mirrors the bottom
    // trailing space, just smaller — that one also clears the sheet's own
    // edge, this one only needs to clear the header above it).
    paddingTop: Spacing.one,
    paddingBottom: LIST_TRAILING_SPACE,
  },
  // Flush by default (see `OptionList`'s popover-padding settle logic above);
  // `gap` lives on `rowsWrapper` instead, since rows sit inside that inner
  // measuring wrapper rather than directly in this contentContainerStyle.
  listContentPopover: {},
  // Applied alongside `listContentPopover` once the settle logic decides the
  // content comfortably fits without scrolling.
  listContentPopoverPadded: {
    paddingVertical: Spacing.four,
  },
  // Shared by both presentations — the inner View `OptionList` measures its
  // rows against, unpadded so neither presentation's fits/needs-scroll
  // decision gets thrown off by the padding it's used to decide.
  rowsWrapper: {
    gap: Spacing.two,
  },
});

// `node` (not `render`) so each overlay's content is only ever built once, at
// `open()` time — otherwise `items.map` below would call every currently-open
// overlay's `render()` afresh on every `OverlayProvider` re-render (e.g.
// whenever a second overlay opens on top), needlessly re-rendering overlays
// that aren't even changing. Keeping the same `ReactNode` reference across
// renders lets React bail out of re-rendering that subtree entirely.
type Item = { id: number; node: ReactNode; anchor?: AnchorRect | null; popover?: boolean };

/** What the stack still holds, for a watchdog entry. The first question anyone asks of one of
 *  those is whether the app was pushed back by an overlay that never left (items listed) or by a
 *  progress value that never came home with the stack already empty (`items=0`) — different bugs
 *  with the same symptom, told apart by this one line. */
function describeItems(items: readonly Item[]): string {
  if (items.length === 0) return 'items=0 (stack empty — the progress value itself never settled)';
  return `items=${items.length} [${items.map((it) => `#${it.id}${it.popover ? ' popover' : ''}${it.anchor ? ' anchored' : ''}`).join(', ')}]`;
}

const SPRING = { damping: 22, stiffness: 240, mass: 0.7 } as const;
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// How long a sheet takes to slide back off screen, and how long after that its removal is allowed
// to arrive. An exit that hasn't reported in by the backstop is not going to: the item is dropped
// anyway and the fact is logged (see `close` in OverlaySheet, and lib/pushback-watchdog).
const CLOSE_MS = 240;
const CLOSE_BACKSTOP_MS = 900;
// The two pushback signals this file owns, as the watchdog names them.
const APP_PUSHBACK = 'overlay-app-scale';
const BACKDROP_PUSHBACK = 'overlay-backdrop';

/**
 * One sheet's exit state: the "already leaving" latch and its backstop timer.
 *
 * Module-level and keyed on a per-instance token rather than held in refs, which is not a style
 * choice — the drag pans are built during render and reach `close`, and `react-hooks/refs`
 * (correctly) can't prove a gesture callback only ever runs after commit. This is the one shape the
 * rule allows, and it is what `app/series/index.tsx`'s `LEFT` latch settled on for exactly the same
 * reason. Plain JS on one thread, so unlike a shared value a write here is visible to the next read.
 */
type SheetExit = { closing: boolean; backstop: ReturnType<typeof setTimeout> | null };
const EXITS = new WeakMap<object, SheetExit>();
function exitState(token: object): SheetExit {
  let exit = EXITS.get(token);
  if (!exit) {
    exit = { closing: false, backstop: null };
    EXITS.set(token, exit);
  }
  return exit;
}

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const idRef = useRef(0);
  const itemsRef = useRef<Item[]>([]);
  const closers = useRef(new Map<number, () => void>());
  // Each open popover's last-known screen rect (web desktop only — see the
  // outside-click effect below), keyed by item id.
  const popoverRects = useRef(new Map<number, { left: number; top: number; width: number; height: number }>());

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const open = useCallback((render: () => ReactNode, anchor?: AnchorRect | null, opts?: { popover?: boolean }) => {
    const id = idRef.current++;
    // Traced (in memory, one line per open — not per frame) because a stuck pushback is a question
    // about WHICH overlay never left, and by the time anyone notices, the app has been used for
    // minutes since. See lib/pushback-watchdog.
    notePushback('overlay open', `id=${id}${anchor ? ' anchored' : ''}${opts?.popover ? ' popover' : ''}`);
    setItems((prev) => [...prev, { id, node: render(), anchor, ...(opts?.popover ? { popover: true } : {}) }]);
    return id;
  }, []);

  // Idempotent by construction (`filter` on an id that's already gone is a no-op), which is what
  // lets every exit path below — the curve's own callback, the wall-clock backstop, a second close
  // — call it without any of them having to know whether one of the others got there first.
  const remove = useCallback((id: number) => {
    notePushback('overlay remove', `id=${id}`);
    closers.current.delete(id);
    setItems((prev) => prev.filter((it) => it.id !== id));
  }, []);

  const register = useCallback((id: number, fn: () => void) => {
    closers.current.set(id, fn);
  }, []);

  const closeTop = useCallback(() => {
    const top = itemsRef.current[itemsRef.current.length - 1];
    if (top) closers.current.get(top.id)?.();
  }, []);

  const topId = items.length ? items[items.length - 1].id : null;
  const api = useMemo(() => ({ open, closeTop, topId }), [open, closeTop, topId]);

  // Desktop shows anchored popovers; the mobile sheet's scale-the-app-back and
  // heavy dim are skipped there. On web, a popover's outside-click dismissal
  // is handled by the `pointerdown` listener below rather than the shared
  // backdrop, so the very click that closes the popover also lands on
  // whatever it actually hit underneath (another control, a series card, …)
  // instead of being swallowed by an invisible full-screen catcher — no
  // separate second click needed. Native large-screen (tablet) popovers still
  // fall back to the backdrop below, since there's no DOM to listen on there.
  const isLargeScreen = useIsLargeScreen();
  const isWebPopover = Platform.OS === 'web' && isLargeScreen;

  const depth = items.length;

  useEffect(() => {
    if (!isWebPopover || depth === 0) return;
    const handler = (e: MouseEvent) => {
      const insideAny = Array.from(popoverRects.current.values()).some(
        (r) => e.clientX >= r.left && e.clientX <= r.left + r.width && e.clientY >= r.top && e.clientY <= r.top + r.height,
      );
      if (!insideAny) closeTop();
    };
    // Capture phase, and no preventDefault/stopPropagation: this only decides
    // whether to close the popover — the click itself keeps bubbling to reach
    // its real target normally.
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [isWebPopover, depth, closeTop]);

  // Whether an item presents as a popover (desktop with an anchor, or explicitly forced — a phone
  // context menu). Only SHEETS push the app back and dim heavily; a floating context menu gets a
  // light dim with no scale, so it reads as a popup over the page rather than a modal takeover.
  const isPopoverItem = useCallback(
    (it: Item) => !!it.anchor && (isLargeScreen || !!it.popover),
    [isLargeScreen],
  );
  const sheetDepth = items.filter((it) => !isPopoverItem(it)).length;

  const appProgress = useSharedValue(0);
  const anyProgress = useSharedValue(0);
  // Both effects arm a watchdog on the way back down. These two values ARE the reported bug when
  // they strand — the app left scaled down and dimmed with nothing on top of it, for the rest of
  // the process, because `OverlayProvider` outlives every screen and no navigation resets it. The
  // check costs one timer per close and only runs when the stack has emptied; if the value really
  // did come back to rest (the overwhelmingly common case) it reports nothing at all.
  useEffect(() => {
    appProgress.set(withSpring(sheetDepth > 0 ? 1 : 0, SPRING));
    if (sheetDepth > 0) {
      cancelSettleCheck(APP_PUSHBACK);
      return;
    }
    armSettleCheck(
      APP_PUSHBACK,
      sharedPushback(appProgress),
      () => describeItems(itemsRef.current),
      () => itemsRef.current.length === 0,
    );
  }, [sheetDepth, appProgress]);
  useEffect(() => {
    anyProgress.set(withSpring(depth > 0 ? 1 : 0, SPRING));
    if (depth > 0) {
      cancelSettleCheck(BACKDROP_PUSHBACK);
      return;
    }
    armSettleCheck(
      BACKDROP_PUSHBACK,
      sharedPushback(anyProgress),
      () => describeItems(itemsRef.current),
      () => itemsRef.current.length === 0,
    );
  }, [depth, anyProgress]);

  const appStyle = useAnimatedStyle(() =>
    isLargeScreen
      ? { transform: [{ scale: 1 }], borderRadius: 0 }
      : {
          transform: [{ scale: interpolate(appProgress.value, [0, 1], [1, 0.93]) }],
          borderRadius: interpolate(appProgress.value, [0, 1], [0, 28]),
        },
  );
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: isLargeScreen
      ? 0
      : Math.max(
          interpolate(appProgress.value, [0, 1], [0, 0.5]),
          interpolate(anyProgress.value, [0, 1], [0, 0.18]),
        ),
  }));

  // The app scales down + rounds its corners while any overlay is open (below),
  // exposing this root color in the margin around it — was hardcoded black
  // regardless of theme, showing as a stray dark bar (most visible behind a
  // bottom sheet) instead of matching the actual page background.
  const theme = useTheme();

  return (
    <OverlayContext.Provider value={api}>
      <View style={[styles.root, { backgroundColor: theme.background }]}>
        <Animated.View style={[styles.appWrap, appStyle]}>{children}</Animated.View>

        {/* `pointerEvents` is a PROP, not a member of the style array. Reanimated updates the
            animated (opacity) part of that array imperatively on the UI thread and doesn't
            reliably re-diff a static sibling in it on every JS re-render — which on web leaves the
            node's raw inline style holding a stale `pointer-events`, invisible to the eye and
            wrong for touches in both directions: a dismissed overlay's backdrop keeps swallowing
            clicks, or a live one stops accepting the tap that would close it. Exactly the bug
            already fixed this way in the reader's toolbar/pill/settings control. */}
        <AnimatedPressable
          style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}
          pointerEvents={depth > 0 && !isWebPopover ? 'auto' : 'none'}
          onPress={closeTop}
        />

        {items.map((it, i) =>
          isPopoverItem(it) && it.anchor ? (
            <OverlayPopover
              key={it.id}
              id={it.id}
              anchor={it.anchor}
              onClosed={() => remove(it.id)}
              register={register}
              onRect={(r) => {
                if (r) popoverRects.current.set(it.id, r);
                else popoverRects.current.delete(it.id);
              }}>
              {it.node}
            </OverlayPopover>
          ) : (
            <OverlaySheet
              key={it.id}
              id={it.id}
              depthFromTop={items.length - 1 - i}
              onClosed={() => remove(it.id)}
              register={register}>
              {it.node}
            </OverlaySheet>
          ),
        )}
      </View>
    </OverlayContext.Provider>
  );
}

function OverlaySheet({
  id,
  depthFromTop,
  onClosed,
  register,
  children,
}: {
  id: number;
  depthFromTop: number;
  onClosed: () => void;
  register: (id: number, fn: () => void) => void;
  children: ReactNode;
}) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(height);
  const depthSV = useSharedValue(depthFromTop);
  const isTop = depthFromTop === 0;

  // Scroll coordination for drag-to-dismiss from the content (see SheetScroll).
  const scrollRef = useRef<ComponentType | null>(null);
  const scrollOffset = useSharedValue(0);
  // True once a content drag has "engaged" the sheet (list at top, pulling
  // down); the baseline is the drag distance at that moment, so the sheet
  // doesn't jump by however far the list was scrolled first.
  const dragging = useSharedValue(false);
  const dragBaseline = useSharedValue(0);
  const sheetScroll = useMemo<SheetScroll>(() => ({ scrollRef, scrollOffset }), [scrollOffset]);

  // Keyboard avoidance. Rather than nudge the sheet up by just the focused
  // input's overlap (which lifts the sheet's *bottom* off the keyboard top,
  // leaving a gap that then needs patching), we lift the whole sheet so its
  // bottom edge lands exactly on the keyboard's top: shift by the full keyboard
  // height. That way the sheet reads as one surface sitting on the keyboard with
  // no gap and no filler — everything in it (the input included) is above the
  // keyboard. A tall sheet can't rise the full amount without its top clipping
  // past `insets.top`, so the shift is capped at `maxShift`; when it's capped
  // the sheet's bottom simply stays *behind* the keyboard (still no gap), and
  // its top pins just below the safe-area top.
  //
  // `isFocused` gates this to the one sheet that actually owns the focused input
  // (the keyboard is up for the whole app, but only that sheet should move);
  // `reportFocus` also carries the input's bottom edge, unused by the shift now
  // but kept for the focus signal.
  const isFocused = useSharedValue(false);
  const sheetHeightSV = useSharedValue(0);
  const keyboard = useAnimatedKeyboard();
  const keyboardShift = useDerivedValue(() => {
    const kbHeight = keyboard.height.value;
    if (kbHeight <= 0 || !isFocused.value) return 0;
    const sheetTop = height - sheetHeightSV.value;
    const maxShift = Math.max(0, sheetTop - insets.top - Spacing.four);
    return Math.min(kbHeight, maxShift);
  });
  const reportFocus = useCallback(
    (_bottomY: number) => {
      isFocused.set(true);
    },
    [isFocused],
  );
  const reportBlur = useCallback(() => {
    isFocused.set(false);
  }, [isFocused]);
  const sheetKeyboard = useMemo<SheetKeyboard>(
    () => ({ reportFocus, reportBlur }),
    [reportFocus, reportBlur],
  );

  // Real budget (not content-derived) for this sheet's header+list content —
  // see the note above `ROW_UNIT_HEIGHT` for why `OptionList` needs an actual
  // number here rather than a `flexGrow` chain up through `sheetBody`.
  const [headerHeight, setHeaderHeight] = useState(0);
  const sheetBudget = height - insets.top - Spacing.four - HANDLE_AREA_HEIGHT;
  const budget = useMemo<SheetBudget>(
    () => ({ budget: sheetBudget, headerHeight, setHeaderHeight }),
    [sheetBudget, headerHeight],
  );

  // Whether this sheet's content (reported by its `OptionList`, see
  // `SheetContentScrollContext`) needs an internal scroll — starts `false`
  // (assume it fits), the opposite of `OptionList`'s own internal default.
  // Plenty of sheet content (confirm dialogs, short forms like the "add
  // registry" prompt) renders fixed content with no `OptionList` at all, so
  // it never reports anything; defaulting to `true` here would leave those
  // permanently un-cushioned since nothing would ever flip it back. Content
  // that *does* use `OptionList` corrects this soon after mount if it turns
  // out to need scrolling — see `evaluate` there, which only ever reports
  // off a real measurement. Drives the same fits→cushioned, scrolls→flush
  // chrome the desktop popover already has (see `styles.sheet` below).
  const [contentNeedsScroll, setContentNeedsScroll] = useState(false);

  // The one-way "this sheet is leaving" latch, in the two forms the two threads need: plain JS for
  // `close` itself (see `EXITS`), and a shared value the pans' worklets can read. Not one or the
  // other — a `.set()` on a shared value is not guaranteed visible to a `.get()` in the next JS
  // task (its home is the UI thread), and a worklet cannot read the JS side.
  const token = useMemo(() => ({}), []);
  const closingSV = useSharedValue(false);

  const finishClose = useCallback(() => {
    const exit = exitState(token);
    if (exit.backstop !== null) {
      clearTimeout(exit.backstop);
      exit.backstop = null;
    }
    onClosed();
  }, [onClosed, token]);

  /**
   * Leaving, once. The item is removed by the exit curve REGARDLESS of `finished`, and a wall-clock
   * backstop removes it even if that callback never arrives at all.
   *
   * Both halves are the fix for the same bug, and it is the one this whole file's pushback is
   * hostage to: an item leaves `items` only from here, `items` is what scales the app back and
   * dims it, and `OverlayProvider` sits above every screen — so an item that fails to leave leaves
   * the app zoomed out and dimmed with nothing visibly open, for the rest of the process. Gating
   * removal on `finished` made that a live possibility on every close: reanimated reports
   * `finished: false` for any curve that got interrupted, so a touch landing on the sheet while it
   * slid away, or a resize remounting it mid-exit, silently stranded the item. An animation
   * callback is not a promise that it ran (the series page reached the same conclusion the hard
   * way — see `leaveOnce` in app/series/index.tsx). Ignoring `finished` is safe precisely because
   * this latch means there is no way back: nothing un-closes a sheet, the pans below stand down
   * once it is set, and `onClosed` is idempotent.
   */
  const close = useCallback(() => {
    const exit = exitState(token);
    if (exit.closing) return;
    exit.closing = true;
    closingSV.set(true);
    notePushback('overlay sheet close', `id=${id}`);
    exit.backstop = setTimeout(() => {
      exit.backstop = null;
      reportStuck(
        'overlay-sheet',
        `exit curve never reported back after ${CLOSE_BACKSTOP_MS}ms (id ${id}) — removed by the backstop`,
      );
      onClosed();
    }, CLOSE_BACKSTOP_MS);
    translateY.set(
      withTiming(height, { duration: CLOSE_MS }, () => {
        runOnJS(finishClose)();
      }),
    );
  }, [closingSV, finishClose, height, id, onClosed, token, translateY]);

  // The backdrop's closer is registered once, at mount, but `close` is rebuilt whenever the window
  // height changes — so the registration goes through a box rather than capturing the mount-time
  // one, which would animate a rotated sheet to the OLD height and leave it parked on screen.
  // Assigned in an effect of its own (never during render) and only ever read after commit.
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  }, [close]);

  // Mount: slide up + register the imperative close used by the backdrop.
  useEffect(() => {
    translateY.set(withSpring(0, SPRING));
    register(id, () => closeRef.current());
    return () => {
      const backstop = EXITS.get(token)?.backstop;
      if (backstop) clearTimeout(backstop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    depthSV.set(withSpring(depthFromTop, SPRING));
  }, [depthFromTop, depthSV]);

  // A committed drag hands the sheet to `close` rather than running its own exit: one exit path
  // means one latch, one backstop and one removal, instead of a second copy of all three that has
  // to stay in step with the first.
  const dismissOrSnapBack = (translation: number, velocity: number) => {
    'worklet';
    if (translation > 120 || velocity > 900) {
      runOnJS(close)();
    } else {
      translateY.set(withSpring(0, SPRING));
    }
  };

  // Drag the handle down to dismiss (always available — the handle sits above
  // any scrollable content). Both pans check the closing latch INSIDE the worklet as well as
  // through `enabled`: a sheet stays mounted and topmost while it slides away, so without this a
  // touch landing on it mid-exit would take `translateY` back off the exit curve — which used to
  // be exactly how an item got stranded in the stack with the app left scaled down behind it.
  const handlePan = Gesture.Pan()
    .enabled(isTop)
    .onUpdate((e) => {
      if (closingSV.value) return;
      translateY.set(Math.max(0, e.translationY));
    })
    .onEnd((e) => {
      if (closingSV.value) return;
      dismissOrSnapBack(e.translationY, e.velocityY);
    });

  // Drag the sheet down from its content too, but only once the inner list is
  // at the top: while the list can still scroll up the gesture runs
  // simultaneously and leaves the sheet put; at the top a continued downward
  // drag chains into dismissal.
  const contentPan = Gesture.Pan()
    .enabled(isTop)
    .activeOffsetY(12)
    // eslint-disable-next-line react-hooks/refs -- RNGH's documented API takes the ref itself; it reads .current when the gesture runs, never during this render.
    .simultaneousWithExternalGesture(scrollRef)
    .onBegin(() => {
      dragging.set(false);
    })
    .onUpdate((e) => {
      if (closingSV.value) return;
      if (!dragging.value) {
        if (scrollOffset.value <= 0 && e.translationY > 0) {
          dragging.set(true);
          dragBaseline.set(e.translationY);
        } else {
          return;
        }
      }
      // Reversed back into scrollable content — hand control back to the list.
      if (scrollOffset.value > 0) {
        dragging.set(false);
        translateY.set(0);
        return;
      }
      translateY.set(Math.max(0, e.translationY - dragBaseline.value));
    })
    .onEnd((e) => {
      const moved = dragging.value;
      dragging.set(false);
      if (closingSV.value) return;
      if (moved) dismissOrSnapBack(translateY.value, e.velocityY);
    });

  const sheetStyle = useAnimatedStyle(() => {
    const scale = interpolate(depthSV.value, [0, 1, 2], [1, 0.92, 0.86], Extrapolation.CLAMP);
    const lift = interpolate(depthSV.value, [0, 1, 2], [0, -14, -26], Extrapolation.CLAMP);
    return { transform: [{ translateY: translateY.value + lift - keyboardShift.value }, { scale }] };
  });

  const dimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(depthSV.value, [0, 1], [0, 0.45], Extrapolation.CLAMP),
  }));

  return (
    <Animated.View style={[styles.sheetWrap, sheetStyle, { pointerEvents: 'box-none' }]}>
      <OverlayPresentationContext.Provider value="sheet">
      <SheetScrollContext.Provider value={sheetScroll}>
      <SheetKeyboardContext.Provider value={sheetKeyboard}>
      <SheetBudgetContext.Provider value={budget}>
      <SheetContentScrollContext.Provider value={setContentNeedsScroll}>
        {/* `backgroundPanel` (not the default `background`) so the sheet's own
            surface reads as one consistent panel color instead of showing a
            seam where the base page background peeks through; distinct from
            `backgroundElement` (used by the rows on it) so those still stand
            out against the panel.
            Bottom cushion (`insets.bottom`) only when the content doesn't need
            its own internal scroll: reserving it unconditionally left a
            same-colored gap below the last row of a *tall* list that read as
            broken content rather than a clean edge (confirmed by pixel-
            sampling a screenshot, not just eyeballing it) — a scrolling
            sheet's own edge sits exactly where its content ends, gesture-nav
            pill included. But a *short* sheet has nothing to lose that edge
            to, so it gets the real device-chrome clearance back, matching the
            desktop popover's own fits→padded chrome (see `OptionList`).
            Breathing room below the *content* itself (so a short list doesn't
            sit flush against this padding) is still `OptionList`'s own
            trailing padding (`listContent` above) / the overflow-filters
            sheet's own content padding, not this outer container. */}
        <View
          onLayout={(e) => { sheetHeightSV.set(e.nativeEvent.layout.height); }}
          style={[
            styles.sheet,
            {
              maxHeight: height - insets.top - Spacing.four,
              paddingBottom: contentNeedsScroll ? 0 : insets.bottom,
            },
          ]}>
          {/* The panel color lives on this square, non-rounded fill — NOT on the
              container above, which keeps only its top-corner radius, for clipping
              (`overflow: 'hidden'`). RN 0.85's Fabric `BackgroundDrawable.draw`
              hard-crashes (`IllegalStateException: Required value was null`) when it
              paints a background on a view that has *non-uniform* corner radii and no
              border: it takes a `drawPath` branch and dereferences a null render path
              (BackgroundDrawable.kt). That branch is gated on the view having a
              background at all, so a backgroundless rounded container never reaches it;
              this fill is uniform (square) and gets clipped to the rounded top by the
              parent, so the look is unchanged. */}
          <ThemedView type="backgroundPanel" style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]} />
          <GestureDetector gesture={handlePan}>
            <View style={styles.handleArea}>
              <View style={styles.handle} />
            </View>
          </GestureDetector>

          <GestureDetector gesture={contentPan}>
            <View style={styles.sheetBody}>{children}</View>
          </GestureDetector>

          <Animated.View
            style={[StyleSheet.absoluteFill, styles.dim, dimStyle, { pointerEvents: 'none' }]}
          />
        </View>
      </SheetContentScrollContext.Provider>
      </SheetBudgetContext.Provider>
      </SheetKeyboardContext.Provider>
      </SheetScrollContext.Provider>
      </OverlayPresentationContext.Provider>
    </Animated.View>
  );
}

// Desktop presentation: a card anchored next to its trigger. Drops in below the
// anchor by default, flips above when it would overflow the bottom, clamps
// horizontally to stay on-screen, and fades + scales in. No drag handle or pan
// gestures (those are sheet-only); the shared backdrop handles outside-click
// dismissal. Long content scrolls inside via the content's own list.
const POPOVER_WIDTH = 320;
const POPOVER_GAP = Spacing.one; // distance from the anchor edge
const POPOVER_PAD = Spacing.three; // keep-off-the-viewport-edges padding

function OverlayPopover({
  id,
  anchor,
  onClosed,
  register,
  onRect,
  children,
}: {
  id: number;
  anchor: AnchorRect;
  onClosed: () => void;
  register: (id: number, fn: () => void) => void;
  /** Reports this popover's current screen rect (or `null` on unmount) so the
   *  outside-click listener in OverlayProvider knows what counts as "inside". */
  onRect?: (rect: { left: number; top: number; width: number; height: number } | null) => void;
  children: ReactNode;
}) {
  const { width: vw, height: vh } = useWindowDimensions();
  const [card, setCard] = useState<{ width: number; height: number } | null>(null);
  const progress = useSharedValue(0);
  const entered = useRef(false);
  // Same one-way latch and backstop as `OverlaySheet` — see the long note on its `close`. A stuck
  // popover doesn't scale the app back (only sheets do), but it does hold the backdrop's dim up and
  // its `pointerEvents` with it, so a stranded one swallows every touch until the app restarts.
  const closingRef = useRef(false);
  const backstopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finishClose = useCallback(() => {
    if (backstopRef.current !== null) {
      clearTimeout(backstopRef.current);
      backstopRef.current = null;
    }
    onClosed();
  }, [onClosed]);

  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    notePushback('overlay popover close', `id=${id}`);
    backstopRef.current = setTimeout(() => {
      backstopRef.current = null;
      reportStuck(
        'overlay-popover',
        `exit curve never reported back after ${CLOSE_BACKSTOP_MS}ms (id ${id}) — removed by the backstop`,
      );
      onClosed();
    }, CLOSE_BACKSTOP_MS);
    progress.set(
      withTiming(0, { duration: 120 }, () => {
        runOnJS(finishClose)();
      }),
    );
  }, [finishClose, id, onClosed, progress]);

  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  }, [close]);

  useEffect(() => {
    register(id, () => closeRef.current());
    return () => {
      if (backstopRef.current !== null) clearTimeout(backstopRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fade in only once measured, so the entrance plays at the final (possibly
  // flipped) position with no visible jump.
  //
  // …and never after a close has started. The measurement that sets `card` is asynchronous, so a
  // popover dismissed before it lands (a fast tap-and-tap-away, or a trigger that closes itself on
  // mount) would otherwise start its ENTRANCE on top of its own exit — cancelling that curve, so
  // its callback never removed the item, leaving the backdrop up over an invisible popover.
  useEffect(() => {
    if (card && !entered.current && !closingRef.current) {
      entered.current = true;
      progress.set(withTiming(1, { duration: 140 }));
    }
  }, [card, progress]);

  const width = Math.min(POPOVER_WIDTH, vw - POPOVER_PAD * 2);
  const left = Math.min(Math.max(POPOVER_PAD, anchor.x), vw - width - POPOVER_PAD);
  const spaceBelow = vh - (anchor.y + anchor.height) - POPOVER_GAP - POPOVER_PAD;
  const spaceAbove = anchor.y - POPOVER_GAP - POPOVER_PAD;
  const h = card?.height ?? 0;
  const below = h <= spaceBelow || spaceBelow >= spaceAbove;
  const maxHeight = Math.max(160, below ? spaceBelow : spaceAbove);
  const top = below
    ? anchor.y + anchor.height + POPOVER_GAP
    : Math.max(POPOVER_PAD, anchor.y - POPOVER_GAP - Math.min(h, maxHeight));
  const rectHeight = Math.min(h, maxHeight);

  useEffect(() => {
    onRect?.({ left, top, width, height: rectHeight });
    return () => onRect?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left, top, width, rectHeight]);

  // Same real-number budget as `OverlaySheet` (see the note above
  // `ROW_UNIT_HEIGHT`) — `maxHeight` here is already a real, anchor-clamped
  // number, so it's used directly rather than re-derived.
  const [headerHeight, setHeaderHeight] = useState(0);
  const budget = useMemo<SheetBudget>(() => ({ budget: maxHeight, headerHeight, setHeaderHeight }), [maxHeight, headerHeight]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [below ? -6 : 6, 0]) },
      { scale: interpolate(progress.value, [0, 1], [0.96, 1]) },
    ],
  }));

  return (
    <Animated.View
      style={[styles.popoverWrap, { left, top, width, pointerEvents: 'box-none' }, animStyle]}>
      <ThemedView
        type="backgroundPanel"
        style={[styles.popover, { maxHeight }]}
        onLayout={(e) => {
          const { width: w, height: hh } = e.nativeEvent.layout;
          setCard((prev) => (prev && prev.height === hh && prev.width === w ? prev : { width: w, height: hh }));
        }}>
        <OverlayPresentationContext.Provider value="popover">
          <SheetBudgetContext.Provider value={budget}>{children}</SheetBudgetContext.Provider>
        </OverlayPresentationContext.Provider>
      </ThemedView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    // backgroundColor set inline from the theme (see OverlayProvider) — this
    // is only the layout half of the style.
    flex: 1,
  },
  appWrap: {
    flex: 1,
    overflow: 'hidden',
  },
  backdrop: {
    backgroundColor: '#000000',
  },
  sheetWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
  },
  sheet: {
    width: '100%',
    maxWidth: 520,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: Spacing.four,
    overflow: 'hidden',
  },
  handleArea: {
    alignItems: 'center',
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  handle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(128,128,128,0.45)',
  },
  // No `flex: 1` here (deliberately): that RN shorthand sets `flexBasis: 0`,
  // which Yoga resolves to a literal zero — not content size — inside `sheet`
  // above, whose own height is only capped (`maxHeight`), not definite. A
  // `%`-based flex-basis falls back to content size against an indefinite
  // container on the web (why this ever looked fine there); Yoga doesn't do
  // that fallback, so this collapsed to ~0 height on iOS/Android. Every child
  // here (`MeasuredHeader`, `OptionList`) already sizes itself to a real
  // number (see the note above `ROW_UNIT_HEIGHT`), so this wrapper only needs
  // to hug that content — the plain, unflexed default does that correctly on
  // every platform.
  sheetBody: {
    gap: Spacing.two,
  },
  dim: {
    backgroundColor: '#000000',
  },
  popoverWrap: {
    position: 'absolute',
  },
  popover: {
    borderRadius: 16,
    paddingHorizontal: Spacing.four,
    overflow: 'hidden',
  },
  heading: {
    marginBottom: Spacing.one,
  },
});
