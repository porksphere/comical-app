import { makeImageFromView, type SkImage } from '@shopify/react-native-skia';
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
import { PageCurl, turnId, type CurlTurn } from '@/components/reader/page-curl';
import {
  FLAT,
  TAP_GRAB,
  curlFrame,
  dragGrabY,
  dragPull,
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
import { projectRelease } from '@/lib/gesture-release';

/** What the curl needs of a pager cell: its pages, by picture, and the half a lone page leaves. */
export type CurlCell = { key: string; pages: { uri: string }[]; pad?: SpreadPad };

/**
 * Travel that decides a touch — the distance the slide's UIScrollView claims one at (see
 * `EDGE_ACTIVATE_PX`). Decided there once, the way that scroller locks a drag to its axis: a turn if
 * the finger has gone at least as far across as up or down, given up otherwise. A tighter vertical
 * limit, checked all the way, lost every drag that began on a thumb's arc.
 */
const ACTIVATE_PX = 10;
/** Sideways travel that starts taking the pictures, so they are in by the time the turn starts. */
const PREPARE_PX = 3;
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
  if (here < 0 || here >= data.length || width <= 0 || height <= 0) return null;
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
 * A drag is the UI thread's from its first frame: the turns either way from the spread on screen
 * are planned ahead, after every render and every landing, so the drag arms itself the moment it
 * activates and follows the finger from there, and a flick released before the JS side has heard of
 * it still turns. The pictures are taken as the finger starts across, before the drag activates.
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
  const zoomedSV = useSharedValue(options.zoomed);
  // The turns a drag starts, by the way it goes across the screen.
  const planLeft = useSharedValue<Plan | null>(null);
  const planRight = useSharedValue<Plan | null>(null);
  const turnLeaf = useSharedValue<Leaf | null>(null);
  // Which turn the UI thread's numbers are for (`turnId`).
  const armedTurn = useSharedValue('');
  const mirroredSV = useSharedValue(false);
  const grabY = useSharedValue(0);
  const startT = useSharedValue(0);
  const endT = useSharedValue(1);
  const pullX = useSharedValue(0);
  const pullY = useSharedValue(0);
  const downX = useSharedValue(0);
  const downY = useSharedValue(0);
  const decided = useSharedValue(false);
  const preparing = useSharedValue(false);
  // The travel the decision took, which the turn doesn't follow: it starts from the page's edge.
  const originX = useSharedValue(0);
  const originY = useSharedValue(0);
  const fingerDown = useSharedValue(false);
  const dragging = useSharedValue(false);
  const dragFromX = useSharedValue(0);
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

  /** Put a turn's numbers where the UI thread reads them, from either thread. */
  const arm = useCallback(
    (plan: Plan, y: number) => {
      'worklet';
      const { box } = plan.leaf;
      const grab = Math.min(box.y + box.height, Math.max(box.y, y));
      const start = turnPull(plan.leaf, grab, plan.startT);
      mirroredSV.set(plan.mirrored);
      grabY.set(grab);
      startT.set(plan.startT);
      endT.set(plan.endT);
      pullX.set(start.x);
      pullY.set(start.y);
      dragFromX.set(start.x);
      pathT.set(-1);
      turnLeaf.set(plan.leaf);
      armedTurn.set(turnId(plan));
    },
    [mirroredSV, grabY, startT, endT, pullX, pullY, dragFromX, pathT, turnLeaf, armedTurn],
  );

  // ── JS-side state ──
  const [turn, setTurn] = useState<CurlTurn | null>(null);
  const inFlight = useRef<InFlight | null>(null);
  const tokens = useRef(0);
  const latest = useRef(options);
  // Where the pager is, as of the last turn this hook landed — a second tap in quick succession
  // turns from there, before the render that names it.
  const current = useRef(options.activeIndex);
  // Pictures taken as a drag starts across, by cell, until a turn takes them.
  const prepared = useRef(new Map<string, Promise<SkImage | null>>());

  const replan = useCallback(() => {
    const o = latest.current;
    planLeft.set(o.mode ? planTurn(o, current.current, !o.rtl) : null);
    planRight.set(o.mode ? planTurn(o, current.current, o.rtl) : null);
  }, [planLeft, planRight]);

  useLayoutEffect(() => {
    latest.current = options;
    if (!inFlight.current) current.current = options.activeIndex;
    allowed.set(enabled);
    zoomedSV.set(options.zoomed);
    replan();
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

  const picture = useCallback((key: string): Promise<SkImage | null> => {
    const view = latest.current.cellView(key);
    if (!view) return Promise.resolve(null);
    return makeImageFromView({ current: view as unknown as number }).catch(() => null);
  }, []);

  const dropPrepared = useCallback(() => {
    for (const shot of prepared.current.values()) void shot.then((image) => image?.dispose());
    prepared.current.clear();
  }, []);

  /** Picture the two cells a drag starting across this way would turn between. */
  const prepare = useCallback(
    (movingLeft: boolean) => {
      dropPrepared();
      if (inFlight.current) return;
      // A page's shape may have arrived since the last render: the plan the drag arms from is fresh.
      replan();
      const plan = planTurn(latest.current, current.current, movingLeft !== latest.current.rtl);
      if (!plan) return;
      for (const key of [plan.fromKey, plan.toKey]) prepared.current.set(key, picture(key));
    },
    [dropPrepared, replan, picture],
  );

  /** Take both pictures — the prepared ones where there are — and show the curl once they are in,
   *  unless the turn has moved on. A cell that can't be pictured (not drawn yet) leaves nothing to
   *  show, and `failed` decides what then. */
  const capture = useCallback(
    (flight: InFlight, ready: () => void, failed: () => void) => {
      const take = (key: string) => {
        const shot = prepared.current.get(key);
        prepared.current.delete(key);
        return shot ?? picture(key);
      };
      void Promise.all([take(flight.fromKey), take(flight.toKey)]).then(([a, b]) => {
        const stale = inFlight.current?.token !== flight.token;
        if (stale || !a || !b) {
          a?.dispose();
          b?.dispose();
          if (!stale) failed();
          return;
        }
        setTurn({ id: turnId(flight), leaf: flight.leaf, mirrored: flight.mirrored, from: a, to: b });
        ready();
      });
    },
    [picture],
  );

  const finish = useCallback(
    (token: number, committed: boolean) => {
      const flight = inFlight.current;
      if (!flight || flight.token !== token) return;
      inFlight.current = null;
      // Only if nothing has started since: a turn asked for straight after this one owns the curl.
      // The UI thread's numbers are left as they are: a drag may already have armed the next turn
      // over them.
      const clear = () => {
        if (!inFlight.current) setTurn(null);
      };
      if (!committed) {
        clear();
        return;
      }
      current.current = flight.target;
      replan();
      latest.current.land(flight.target, flight.fromDrag);
      // The curl stands until the pager has drawn the spread under it, which it then shows exactly.
      requestAnimationFrame(() => requestAnimationFrame(clear));
    },
    [replan],
  );

  /** Land a turn still in flight at once: a finger came down on it, or a second turn was asked for
   *  before it finished. A drag lands the way `dragCommitted` says — what its release decided, as
   *  the UI thread knew it when it asked, since by the time this runs that thread may be on the
   *  next drag. */
  const settleNow = useCallback(
    (dragCommitted: boolean) => {
      const flight = inFlight.current;
      if (!flight) return;
      cancelAnimation(pathT);
      finish(flight.token, flight.fromDrag ? dragCommitted : true);
    },
    [finish, pathT],
  );

  const turnTo = useCallback(
    (index: number): boolean => {
      if (!latest.current.enabled) return false;
      // A drag still under the finger falls back.
      const held = inFlight.current?.fromDrag === true && dragging.value;
      if (held) dragging.set(false);
      settleNow(!held && releasedCommitted.value);
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
    [settleNow, arm, capture, finish, pathArc, pathT, dragging, releasedCommitted],
  );

  /**
   * The JS side of a drag the UI thread has armed with `armed`: the turn in flight, and its
   * pictures. The pager may have moved since that plan was made — a turn landing as the finger came
   * down — and then the drag is re-armed from where it is now, or dropped if it was already let go.
   */
  const beginDrag = useCallback(
    (armed: Plan, movingLeft: boolean, y: number) => {
      settleNow(releasedCommitted.value);
      const o = latest.current;
      const fresh = planTurn(o, current.current, movingLeft !== o.rtl);
      let plan = armed;
      if (!fresh || fresh.fromKey !== armed.fromKey || fresh.toKey !== armed.toKey) {
        if (!fresh || !fingerDown.value) {
          dragging.set(false);
          return;
        }
        plan = fresh;
        arm(plan, dragGrabY(plan.leaf, y));
      }
      const token = ++tokens.current;
      const flight: InFlight = { ...plan, token, fromDrag: true };
      inFlight.current = flight;
      o.onDragBegin?.();
      // Without pictures the drag still turns the page on release; it just isn't drawn curling.
      capture(flight, () => {}, () => {});
    },
    [settleNow, arm, capture, fingerDown, dragging, releasedCommitted],
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
        .manualActivation(true)
        // eslint-disable-next-line react-hooks/refs -- a worklet: it reaches the in-flight turn (via settleNow) only when a finger comes down, never during this render.
        .onTouchesDown((e) => {
          'worklet';
          const t = e.allTouches[0];
          if (!t || e.numberOfTouches !== 1) return;
          downX.set(t.x);
          downY.set(t.y);
          decided.set(false);
          preparing.set(false);
          // A turn still finishing lands under the finger, as a scroll still moving stops under one:
          // the next drag turns on from the page it was going to.
          if (!dragging.value) {
            cancelAnimation(pathT);
            runOnJS(settleNow)(releasedCommitted.value);
          }
        })
        // eslint-disable-next-line react-hooks/refs -- a worklet: it reaches the prepared pictures (via prepare) only as a finger moves, never during this render.
        .onTouchesMove((e, state) => {
          'worklet';
          if (decided.value) return;
          const t = e.allTouches[0];
          if (!t) return;
          const dx = t.x - downX.value;
          const dy = t.y - downY.value;
          const across = Math.abs(dx) >= Math.abs(dy);
          // A zoomed page's own pan most likely takes the drag; its pictures wait for the turn.
          if (!preparing.value && allowed.value && !zoomedSV.value && across && Math.abs(dx) >= PREPARE_PX) {
            preparing.set(true);
            runOnJS(prepare)(dx < 0);
          }
          if (Math.hypot(dx, dy) < ACTIVATE_PX) return;
          decided.set(true);
          if (allowed.value && across && (dx < 0 ? planLeft.value : planRight.value)) state.activate();
          else state.fail();
        })
        // eslint-disable-next-line react-hooks/refs -- a worklet: it reaches the in-flight turn (via beginDrag) only when a drag starts, never during this render.
        .onStart((e) => {
          'worklet';
          const movingLeft = e.translationX < 0;
          const plan = movingLeft ? planLeft.value : planRight.value;
          if (!plan) return;
          fingerDown.set(true);
          originX.set(e.translationX);
          originY.set(e.translationY);
          arm(plan, dragGrabY(plan.leaf, e.y));
          dragging.set(true);
          runOnJS(beginDrag)(plan, movingLeft, e.y);
        })
        .onUpdate((e) => {
          'worklet';
          const leaf = turnLeaf.value;
          if (!dragging.value || !leaf) return;
          const tx = (mirroredSV.value ? -1 : 1) * (e.translationX - originX.value);
          const pull = dragPull(leaf, grabY.value, dragFromX.value, tx, e.translationY - originY.value);
          pullX.set(pull.x);
          pullY.set(pull.y);
        })
        // eslint-disable-next-line react-hooks/refs -- a worklet: it reaches the in-flight turn (via releaseDrag) only once a released drag has finished turning, never during this render.
        .onEnd((e, success) => {
          'worklet';
          fingerDown.set(false);
          const leaf = turnLeaf.value;
          if (!dragging.value || !leaf) return;
          dragging.set(false);
          const vx = mirroredSV.value ? -e.velocityX : e.velocityX;
          const headed = turnProgress(leaf, pullX.value + projectRelease(vx));
          const committed =
            success && (endT.value === 1 ? headed > COMMIT_PROGRESS : headed < 1 - COMMIT_PROGRESS);
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
        })
        // eslint-disable-next-line react-hooks/refs -- a worklet: it reaches the prepared pictures (via dropPrepared) only once the touch is over, never during this render.
        .onFinalize(() => {
          'worklet';
          fingerDown.set(false);
          // A turn that started has taken its pictures by now; any others were for a drag that
          // never became one.
          runOnJS(dropPrepared)();
        }),
    [
      mode,
      allowed,
      zoomedSV,
      planLeft,
      planRight,
      downX,
      downY,
      decided,
      preparing,
      originX,
      originY,
      settleNow,
      prepare,
      beginDrag,
      arm,
      fingerDown,
      dragging,
      turnLeaf,
      mirroredSV,
      pullX,
      pullY,
      dragFromX,
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
      dropPrepared,
    ],
  );

  const overlay = turn ? (
    <PageCurl turn={turn} armed={armedTurn} frame={frame} width={width} height={height} />
  ) : null;
  return { pan, turnTo, overlay };
}
