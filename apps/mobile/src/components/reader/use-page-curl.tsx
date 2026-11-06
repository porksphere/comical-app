import { makeImageFromView } from '@shopify/react-native-skia';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ViewInstance } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedReaction,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { containedSize } from '@/components/reader/page-geometry';
import { PageCurl, type CurlTurn } from '@/components/reader/page-curl';
import {
  FLAT,
  TAP_GRAB,
  curlFrame,
  halfPageBox,
  makeLeaf,
  singlePageBox,
  turnProgress,
  turnPull,
  type Box,
  type Leaf,
  type Radii,
} from '@/components/reader/page-curl-geometry';
import { knownPageSize, spreadHalves, type SpreadPad } from '@/components/reader/spreads';
import type { PageFit } from '@/hooks/use-reader-settings';
import { BACK_ACTIVATE_DOMINANCE } from '@/lib/back-swipe';
import { projectRelease } from '@/lib/gesture-release';

/** What the curl needs of a pager cell: its pages, by picture, and the half a lone page leaves. */
export type CurlCell = { key: string; pages: { uri: string }[]; pad?: SpreadPad };

/** Sideways travel that starts a turn — the pager's own (see `EDGE_ACTIVATE_PX`) — and the vertical
 *  travel that gives the drag up to the reader's way out, through the same dominance. */
const ACTIVATE_PX = 10;
const FAIL_PX = Math.round(ACTIVATE_PX * BACK_ACTIVATE_DOMINANCE);
/** How far through the turn a release has to be headed to finish it rather than fall back. */
const COMMIT_PROGRESS = 0.25;
/** A tap's turn, start to finish. */
const TAP_TURN_MS = 520;

type Options = {
  /** Curl mode. Out of it the drag isn't there at all. */
  mode: boolean;
  /** And nothing in the way of a turn (a pinch, the standby strip). */
  enabled: boolean;
  width: number;
  height: number;
  rtl: boolean;
  double: boolean;
  pageFit: PageFit;
  zoomed: boolean;
  /** The pager's cells in physical (screen) order. */
  data: readonly CurlCell[];
  activeIndex: number;
  /** The corners of the pager's viewport: the screen's, where the viewport reaches them. */
  display: Radii;
  /** The view a cell is drawn in, for its picture. */
  cellView: (key: string) => ViewInstance | null | undefined;
  /** Settle the pager on a physical index; a drag's landing is also reported as a settled page. */
  land: (index: number, fromDrag: boolean) => void;
  onDragBegin?: () => void;
};

type Plan = {
  target: number;
  leaf: Leaf;
  mirrored: boolean;
  /** Where the turn starts and where finishing it ends, as turn progress: a page turned back on its
   *  own comes back over the page from where it lay turned (see `planTurn`). */
  startT: number;
  endT: number;
  /** The cells the pictures are taken from: the turn runs from the first to the second. */
  fromKey: string;
  toKey: string;
};

type InFlight = Plan & { token: number; fromDrag: boolean };

/**
 * The turn from the spread on screen toward `readingForward`, or null where there is none (either
 * end of the window — a chapter beyond it is the edge swipe's, see `edgeTurn`).
 *
 * Two pages: the leaf is the page on the side the turn starts from, carried over the spine, both of
 * its sides printed. One page: the page turns about its inner edge and leaves; turning BACK, the
 * page before it comes back over it from where it lay turned, which is the forward turn played in
 * reverse.
 */
function planTurn(o: Options, here: number, readingForward: boolean): Plan | null {
  const { data, rtl, double, width, height, pageFit, zoomed, display } = o;
  const viewport = { width, height };
  const logical = rtl ? data.length - 1 - here : here;
  const targetLogical = logical + (readingForward ? 1 : -1);
  if (targetLogical < 0 || targetLogical >= data.length) return null;
  const target = rtl ? data.length - 1 - targetLogical : targetLogical;
  const movingLeft = readingForward !== rtl;
  const sizeOf = (uri: string | undefined) => (uri ? (knownPageSize(uri) ?? null) : null);
  if (!double) {
    const back = !readingForward;
    const fromCell = data[back ? target : here]!;
    const toCell = data[back ? here : target]!;
    const box: Box =
      zoomed && !back ? { x: 0, y: 0, width, height } : singlePageBox(sizeOf(fromCell.pages[0]?.uri), viewport, pageFit, rtl);
    return {
      target,
      leaf: makeLeaf(box, viewport, display, false, rtl),
      mirrored: rtl,
      startT: back ? 1 : 0,
      endT: back ? 0 : 1,
      fromKey: fromCell.key,
      toKey: toCell.key,
    };
  }
  const fromCell = data[here]!;
  const side = movingLeft ? 'right' : 'left';
  let box: Box;
  if (fromCell.pages.length === 1 && !fromCell.pad) {
    // A wide page alone: the half of it on the turning side.
    const size = sizeOf(fromCell.pages[0]?.uri);
    const shown = size ? containedSize(size, viewport) : viewport;
    box = { x: (width - shown.width) / 2, y: (height - shown.height) / 2, width: shown.width, height: shown.height };
  } else {
    const halves = spreadHalves(fromCell);
    const onScreen = rtl ? [...halves].reverse() : halves;
    box = halfPageBox(sizeOf(onScreen[side === 'left' ? 0 : 1]?.uri), viewport, side);
  }
  return {
    target,
    leaf: makeLeaf(box, viewport, display, true, !movingLeft),
    mirrored: !movingLeft,
    startT: 0,
    endT: 1,
    fromKey: fromCell.key,
    toKey: data[target]!.key,
  };
}

/**
 * The page curl's half of the native pager (`paged-reader.tsx`): a drag that turns the page under
 * the finger, a turn played on its own for a tap or a key, and the curl drawn over the pager while
 * either runs. The pager never moves during a turn — scrolling is off under the curl — and jumps to
 * the spread turned to the moment the turn lands, under a curl that by then shows exactly that
 * spread, before the curl goes.
 *
 * The drag gesture is built once: it is one of the gestures every page arbitrates against, and a
 * gesture that changed would rebuild every page's. Everything it reaches on the JS side goes through
 * refs refreshed after each render.
 */
export function usePageCurl(options: Options): {
  pan: ReturnType<typeof Gesture.Pan>;
  turnTo: (index: number) => boolean;
  overlay: ReactNode;
} {
  const { mode, enabled, width, height } = options;

  // ── UI-thread state ──
  const allowed = useSharedValue(enabled);
  const turnLeaf = useSharedValue<Leaf | null>(null);
  const mirroredSV = useSharedValue(false);
  const grabY = useSharedValue(0);
  const startT = useSharedValue(0);
  const endT = useSharedValue(1);
  const pullX = useSharedValue(0);
  const pullY = useSharedValue(0);
  // Down from the drag's activation to its end — a drag let go before the JS side had armed its
  // turn is cancelled there rather than left in flight.
  const fingerDown = useSharedValue(false);
  const dragging = useSharedValue(false);
  const dragFromX = useSharedValue(0);
  const dragFromY = useSharedValue(0);
  // What a released drag decided, for a turn asked for before it finished falling into place.
  const releasedCommitted = useSharedValue(false);
  // A turn finishing on its own: along the turn's own arc (a tap), or straight from where a
  // released finger left it (a drag), 0 → 1.
  const pathT = useSharedValue(-1);
  const pathArc = useSharedValue(false);
  const pathFromX = useSharedValue(0);
  const pathFromY = useSharedValue(0);
  const pathToX = useSharedValue(0);
  const pathToY = useSharedValue(0);

  const frame = useDerivedValue(() => {
    const leaf = turnLeaf.value;
    return leaf ? curlFrame(leaf, grabY.value, pullX.value, pullY.value) : FLAT;
  });

  useAnimatedReaction(
    () => pathT.value,
    (t) => {
      const leaf = turnLeaf.value;
      if (t < 0 || !leaf) return;
      if (pathArc.value) {
        const p = turnPull(leaf, grabY.value, startT.value + (endT.value - startT.value) * t);
        pullX.set(p.x);
        pullY.set(p.y);
      } else {
        pullX.set(pathFromX.value + (pathToX.value - pathFromX.value) * t);
        pullY.set(pathFromY.value + (pathToY.value - pathFromY.value) * t);
      }
    },
  );

  // ── JS-side state ──
  const [turn, setTurn] = useState<CurlTurn | null>(null);
  const inFlight = useRef<InFlight | null>(null);
  const tokens = useRef(0);
  const latest = useRef(options);
  // Where the pager is, as of the last turn this hook landed — a second tap in quick succession
  // turns from there, before the render that names it.
  const current = useRef(options.activeIndex);
  useLayoutEffect(() => {
    latest.current = options;
    if (!inFlight.current) current.current = options.activeIndex;
    allowed.set(enabled);
  });

  // The pictures go when the curl stops drawing them — a frame after, so the frame being drawn as
  // it goes isn't left holding them.
  useEffect(() => {
    if (!turn) return;
    return () => {
      requestAnimationFrame(() => {
        turn.from.dispose();
        turn.to.dispose();
      });
    };
  }, [turn]);

  /** Put the turn's numbers where the UI thread reads them. */
  const arm = useCallback(
    (plan: Plan, y: number) => {
      const grab = Math.min(plan.leaf.box.y + plan.leaf.box.height, Math.max(plan.leaf.box.y, y));
      const start = turnPull(plan.leaf, grab, plan.startT);
      mirroredSV.set(plan.mirrored);
      grabY.set(grab);
      startT.set(plan.startT);
      endT.set(plan.endT);
      pullX.set(start.x);
      pullY.set(start.y);
      dragFromX.set(start.x);
      dragFromY.set(start.y);
      pathT.set(-1);
      turnLeaf.set(plan.leaf);
    },
    [mirroredSV, grabY, startT, endT, pullX, pullY, dragFromX, dragFromY, pathT, turnLeaf],
  );

  /** Take both pictures and show the curl once they are in, unless the turn has moved on. A cell
   *  that can't be pictured (not drawn yet) leaves nothing to show, and `failed` decides what then. */
  const capture = useCallback((flight: InFlight, ready: () => void, failed: () => void) => {
    const { cellView } = latest.current;
    const from = cellView(flight.fromKey);
    const to = cellView(flight.toKey);
    if (!from || !to) {
      failed();
      return;
    }
    const picture = (view: ViewInstance) => makeImageFromView({ current: view as unknown as number }).catch(() => null);
    void Promise.all([picture(from), picture(to)]).then(([a, b]) => {
      const stale = inFlight.current?.token !== flight.token;
      if (stale || !a || !b) {
        a?.dispose();
        b?.dispose();
        if (!stale) failed();
        return;
      }
      setTurn({ leaf: flight.leaf, mirrored: flight.mirrored, from: a, to: b });
      ready();
    });
  }, []);

  const finish = useCallback(
    (token: number, committed: boolean) => {
      const flight = inFlight.current;
      if (!flight || flight.token !== token) return;
      inFlight.current = null;
      // Only if nothing has started since: a turn asked for straight after this one owns the curl.
      const clear = () => {
        if (inFlight.current) return;
        turnLeaf.set(null);
        pathT.set(-1);
        setTurn(null);
      };
      if (!committed) {
        clear();
        return;
      }
      current.current = flight.target;
      latest.current.land(flight.target, flight.fromDrag);
      // The curl stands until the pager has drawn the spread under it, which it then shows exactly.
      requestAnimationFrame(() => requestAnimationFrame(clear));
    },
    [turnLeaf, pathT],
  );

  /** Land a turn still in flight at once: a second turn was asked for before the first finished. A
   *  drag lands the way its release decided, or falls back if the finger is still on it. */
  const settleNow = useCallback(() => {
    const flight = inFlight.current;
    if (!flight) return;
    cancelAnimation(pathT);
    finish(flight.token, flight.fromDrag ? !dragging.value && releasedCommitted.value : true);
  }, [finish, pathT, dragging, releasedCommitted]);

  const turnTo = useCallback(
    (index: number): boolean => {
      if (!latest.current.enabled) return false;
      settleNow();
      const here = current.current;
      const forward = latest.current.rtl ? index < here : index > here;
      const plan = planTurn(latest.current, here, forward);
      if (!plan || plan.target !== index) return false;
      const token = ++tokens.current;
      const flight: InFlight = { ...plan, token, fromDrag: false };
      inFlight.current = flight;
      arm(plan, plan.leaf.box.y + plan.leaf.box.height * TAP_GRAB);
      capture(
        flight,
        () => {
          pathArc.set(true);
          pathT.set(0);
          pathT.set(
            withTiming(1, { duration: TAP_TURN_MS, easing: Easing.inOut(Easing.cubic) }, (done) => {
              if (done) runOnJS(finish)(token, true);
            }),
          );
        },
        // Nothing to animate: the turn lands at once, as a slide-mode tap does.
        () => finish(token, true),
      );
      return true;
    },
    [settleNow, arm, capture, finish, pathArc, pathT],
  );

  const beginDrag = useCallback(
    (movingLeft: boolean, y: number) => {
      if (inFlight.current) return;
      const plan = planTurn(latest.current, current.current, movingLeft !== latest.current.rtl);
      if (!plan) return;
      const token = ++tokens.current;
      const flight: InFlight = { ...plan, token, fromDrag: true };
      inFlight.current = flight;
      arm(plan, y);
      // Let go already: there is no drag left to follow.
      if (!fingerDown.value) {
        finish(token, false);
        return;
      }
      dragging.set(true);
      latest.current.onDragBegin?.();
      // Without pictures the drag still turns the page on release; it just isn't drawn curling.
      capture(flight, () => {}, () => {});
    },
    [arm, capture, finish, fingerDown, dragging],
  );

  // A drag's release, once the turn has finished on its own from where the finger left it. The
  // token is whichever drag is in flight by then.
  const releaseDrag = useCallback(
    (committed: boolean) => {
      const flight = inFlight.current;
      if (flight?.fromDrag) finish(flight.token, committed);
    },
    [finish],
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(mode)
        .maxPointers(1)
        .activeOffsetX([-ACTIVATE_PX, ACTIVATE_PX])
        .failOffsetY([-FAIL_PX, FAIL_PX])
        // eslint-disable-next-line react-hooks/refs -- a worklet: it reaches the in-flight turn (via beginDrag) only when a drag starts, never during this render.
        .onStart((e) => {
          'worklet';
          if (!allowed.value) return;
          fingerDown.set(true);
          runOnJS(beginDrag)(e.translationX < 0, e.y);
        })
        .onUpdate((e) => {
          'worklet';
          if (!dragging.value || !turnLeaf.value) return;
          const tx = mirroredSV.value ? -e.translationX : e.translationX;
          pullX.set(dragFromX.value + tx);
          pullY.set(dragFromY.value + e.translationY);
        })
        // eslint-disable-next-line react-hooks/refs -- a worklet: it reaches the in-flight turn (via releaseDrag) only once a released drag has finished turning, never during this render.
        .onEnd((e) => {
          'worklet';
          fingerDown.set(false);
          const leaf = turnLeaf.value;
          if (!dragging.value || !leaf) return;
          dragging.set(false);
          const vx = mirroredSV.value ? -e.velocityX : e.velocityX;
          const headed = turnProgress(leaf, pullX.value + projectRelease(vx));
          const committed = endT.value === 1 ? headed > COMMIT_PROGRESS : headed < 1 - COMMIT_PROGRESS;
          releasedCommitted.set(committed);
          const to = turnPull(leaf, grabY.value, committed ? endT.value : startT.value);
          const distance = Math.hypot(to.x - pullX.value, to.y - pullY.value);
          pathArc.set(false);
          pathFromX.set(pullX.value);
          pathFromY.set(pullY.value);
          pathToX.set(to.x);
          pathToY.set(to.y);
          pathT.set(0);
          pathT.set(
            withTiming(
              1,
              { duration: 140 + (220 * distance) / Math.max(1, leaf.box.width * 2), easing: Easing.out(Easing.cubic) },
              (done) => {
                if (done) runOnJS(releaseDrag)(committed);
              },
            ),
          );
        }),
    [
      mode,
      allowed,
      beginDrag,
      fingerDown,
      dragging,
      turnLeaf,
      mirroredSV,
      pullX,
      pullY,
      dragFromX,
      dragFromY,
      endT,
      startT,
      grabY,
      releasedCommitted,
      pathArc,
      pathFromX,
      pathFromY,
      pathToX,
      pathToY,
      pathT,
      releaseDrag,
    ],
  );

  const overlay = turn ? <PageCurl turn={turn} frame={frame} width={width} height={height} /> : null;
  return { pan, turnTo, overlay };
}
