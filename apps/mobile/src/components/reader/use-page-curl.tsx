import { makeImageFromView, type SkImage } from '@shopify/react-native-skia';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import type { ViewInstance } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import {
  Easing,
  cancelAnimation,
  runOnJS,
  runOnUI,
  useAnimatedReaction,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { PageCurl, turnId, type LandedTurn, type StagedPicture } from '@/components/reader/page-curl';
import { scrubPicture } from '@/components/reader/scrub-pictures';
import {
  FLAT,
  TAP_GRAB,
  curlFrame,
  dragGrabY,
  dragPull,
  dragTravel,
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
import type { PageFit, SpreadFill } from '@/hooks/use-reader-settings';
import { logDiagnostic } from '@/lib/diagnostics';
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
/**
 * What became of a touch once it had gone `ACTIVATE_PX`, for the trace: a turn asked for, given up as
 * too steep, given up with turning off, or given up with no page that way. A turn asked for that
 * never started is one another gesture took.
 */
const ASKED = 1;
const STEEP = 2;
const OFF = 3;
const NO_PAGE = 4;
/** A drag whose JS side or pictures lag the finger by more than this goes in the diagnostics log. */
const SLOW_MS = 100;
/** The quiet after a landing in which the neighbours' pictures are taken, for the next turn. */
const WARM_MS = 120;
/**
 * A scrub's turns run on their own clock after the scrubber, not under it: a position in spreads
 * that goes after the scrub's at most `SCRUB_MAX_SPEED` spreads a second (faster the further behind
 * it is), easing in as it nears it, and only into a pair of pages whose pictures are in — it waits
 * at the page's edge for the next. Set straight from the scrubber, a scrub that ran on ahead of the
 * pictures stopped dead at each page and started again: a stutter, page by page.
 */
const SCRUB_MIN_SPEED = 4;
const SCRUB_SPEED_PER_SPREAD = 3;
const SCRUB_MAX_SPEED = 14;
/** How quickly the position closes on the scrub's (per second, of the distance) — never past it:
 *  the speed eases up from a standstill (`SCRUB_ACCEL`, per second) but comes down at once, so a run
 *  of turns glides to a stop rather than overshooting and springing back. */
const SCRUB_GAIN = 7;
const SCRUB_ACCEL = 10;
/** Further behind than this, the position goes on to `SCRUB_SKIP_TO` short of the scrub's and turns
 *  only the last pages: a fling across a chapter is not played page by page. */
const SCRUB_SKIP = 6;
const SCRUB_SKIP_TO = 2;
/** How long after the finger last moved the view of the page being read its picture is taken. */
const VIEW_WARM_MS = 400;
/** The longest the page being read counts as moving without word that it has stopped. */
const VIEW_BUSY_LAPSE_MS = 5000;
/** How long after a scrub's turns have landed the cells about the page are pictured. */
const SCRUB_WARM_MS = 600;
/** The longest a released scrub's turns may take to land before the scrub ends anyway. */
const SCRUB_END_MS = 1500;
/** How many pairs on from the scrubber, the way it is going, are drawn ahead. Each picture is the
 *  whole screen's, and so is its copy on the GPU once drawn: more ahead was memory, not smoothness. */
const SCRUB_AHEAD = 2;
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
  /** What fills a spread's spare width: filled, a leaf is the whole half, page and fill. */
  spreadFill: SpreadFill;
  zoomed: boolean;
  /** The pager's cells in physical (screen) order. */
  data: readonly CurlCell[];
  activeIndex: number;
  /** The corners of the pager's viewport: the screen's, where the viewport reaches them. */
  display: Radii;
  /** The view a cell is drawn in, for its picture. */
  cellView: (key: string) => ViewInstance | null | undefined;
  /** Whether that cell has its pages drawn: before that, its picture is of nothing. */
  cellReady: (key: string) => boolean;
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
  /** The cell turned to, by key: its index moves when the spreads pair again as pages load. */
  targetKey: string;
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
  const { data, rtl, double, width, height, pageFit, spreadFill, zoomed, display } = o;
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
      targetKey: data[target]!.key,
    };
  }
  const fromCell = data[here]!;
  const side = movingLeft ? 'right' : 'left';
  let box: Box;
  if (fromCell.pages.length === 1 && !fromCell.pad) {
    // A page alone (a wide one, a strip): the half of it on the turning side, as it lies at rest —
    // which, for a wide page fitted to the height, is the whole screen, the same as a single page's
    // (`singlePageBox`), and the whole screen too where it has been zoomed. From its contained box
    // instead, only a band across the middle of a zoomed page turned, the next page showing above
    // and below it from the first frame.
    box = zoomed ? { x: 0, y: 0, width, height } : singlePageBox(sizeOf(fromCell.pages[0]?.uri), viewport, pageFit, rtl);
  } else {
    const halves = spreadHalves(fromCell);
    const onScreen = rtl ? [...halves].reverse() : halves;
    box = halfPageBox(sizeOf(onScreen[side === 'left' ? 0 : 1]?.uri), viewport, side, spreadFill !== 'off');
  }
  return {
    target,
    leaf: makeLeaf(box, viewport, display, true, !movingLeft),
    mirrored: !movingLeft,
    startT: 0,
    endT: 1,
    fromKey: fromCell.key,
    toKey: data[target]!.key,
    targetKey: data[target]!.key,
  };
}

/** What a cell holds: its pages and the half a lone page leaves. A spread's key is its first
 *  page's, whatever pages it holds, and spreads pair again as pages load — the cell keyed by page 5
 *  can go from pages 5 and 6 to page 5 alone — so a picture is of the cell only while this is what
 *  it was taken of. Keyed by the cell alone, a picture of the old pair stood for good, and every
 *  turn through that cell turned it. */
function contentOf(o: Options, key: string): string {
  const cell = o.data.find((c) => c.key === key);
  return cell ? `${cell.pages.map((p) => p.uri).join('+')}|${cell.pad ?? ''}` : '';
}

/** What a cell's picture depends on beyond the cell itself: one taken under another is not of it. */
function layoutOf(o: Options): string {
  return `${o.width}x${o.height} ${o.pageFit} ${o.double ? 2 : 1} ${o.rtl ? 'rtl' : 'ltr'} ${o.spreadFill}`;
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
  /** A cell's page has arrived: a picture taken of it before is of nothing, and is taken again. */
  pageLoaded: (key: string) => void;
  /** Where a scrub is, as a fractional position in spreads in reading order, or negative with no
   *  scrub: the pager stands on the whole spread and the curl turns to the next by the fraction. */
  scrub: SharedValue<number>;
  /** The finger is moving the view of the page being read, and has stopped (`useZoomable`'s
   *  `onMoving`). */
  viewMoving: (moving: boolean) => void;
  overlay: ReactNode;
} {
  const { mode, enabled, width, height } = options;

  // ── UI-thread state ──
  const allowed = useSharedValue(enabled);
  const zoomedSV = useSharedValue(options.zoomed);
  // The turns a drag starts, by the way it goes across the screen.
  const planLeft = useSharedValue<Plan | null>(null);
  const planRight = useSharedValue<Plan | null>(null);
  // The same from the spread the turn in flight is headed for, handed over the moment it lands:
  // the next drag arms the right turn before the JS side has heard of the landing.
  const nextPlanLeft = useSharedValue<Plan | null>(null);
  const nextPlanRight = useSharedValue<Plan | null>(null);
  const turnLeaf = useSharedValue<Leaf | null>(null);
  // Which turn the UI thread's numbers are for (`turnId`), and the cells it runs between, by key:
  // what the curl draws are the pictures staged under those keys.
  const armedTurn = useSharedValue('');
  const armedFromKey = useSharedValue('');
  const armedToKey = useSharedValue('');
  // The pictures on hand, by cell: the curl draws from these on this thread, so a drag whose
  // pictures were taken ahead is drawn from its first frame, with no render in between.
  const staged = useSharedValue<StagedPicture[]>([]);
  const mirroredSV = useSharedValue(false);
  const grabY = useSharedValue(0);
  const startT = useSharedValue(0);
  const endT = useSharedValue(1);
  const pullX = useSharedValue(0);
  const pullY = useSharedValue(0);
  const downX = useSharedValue(0);
  const downY = useSharedValue(0);
  const decided = useSharedValue(false);
  // Which way the decision found the finger going. The start can't ask the event: a manually
  // activated pan's translation is measured from its activation, so it is zero there.
  const decidedLeft = useSharedValue(false);
  const preparing = useSharedValue(false);
  // The travel the decision took, which the turn doesn't follow: it starts from the page's edge.
  const originX = useSharedValue(0);
  const originY = useSharedValue(0);
  const fingerDown = useSharedValue(false);
  // A finger on the page at all, decided or not: a picture taken then holds up the drag it starts.
  const touching = useSharedValue(false);
  const verdict = useSharedValue(0);
  const verdictDx = useSharedValue(0);
  const verdictDy = useSharedValue(0);
  const started = useSharedValue(false);
  // How far a touch has gone while the last turn was still landing under it.
  const waitDx = useSharedValue(0);
  const waitDy = useSharedValue(0);
  // Where the touch is measured from: where it came down, or for one that waited on a landing,
  // where it was when the landing was done. Measured from where it came down, the drag that
  // waited began with the page already a hundred points and more over, the turn all but skipped.
  const baseX = useSharedValue(0);
  const baseY = useSharedValue(0);
  const dragging = useSharedValue(false);
  const dragFromX = useSharedValue(0);
  // What a released drag decided, for a turn asked for before it finished falling into place.
  const releasedCommitted = useSharedValue(false);
  // A turn finishing on its own: along the turn's own arc (a tap), or straight from where a
  // released finger left it (a drag), 0 → 1.
  const pathT = useSharedValue(-1);
  const pathArc = useSharedValue(false);
  // The turn that has landed, held on this thread: the curl keeps drawing the spread it reached,
  // flat, until the JS side clears it, whatever turn a next drag arms meanwhile. Held on the JS
  // side instead, it arrived after the render that follows a landing, and on a fast run the next
  // drag had hidden the curl by then, over a pager that hadn't jumped yet.
  const landed = useSharedValue<LandedTurn | null>(null);
  // Counts armings, so a turn armed after a landing is known to be the later one even when it runs
  // between the same two cells (a page turned straight back).
  const armSeq = useSharedValue(0);
  // A scrub (see `scrub` in the result): where the scrubber is; where the turns shown are, on their
  // own clock (`SCRUB_MAX_SPEED`), and how fast that is going; the pair whose turn is armed; the
  // pairs whose pictures are in, by the spread each turns on from; where a released scrub lands;
  // and whether a scrub's turns are running at all.
  const scrubPos = useSharedValue(-1);
  const scrubAt = useSharedValue(-1);
  const scrubSpeed = useSharedValue(0);
  const scrubBase = useSharedValue(-1);
  const scrubPairs = useSharedValue<Record<string, Plan>>({});
  const scrubLanding = useSharedValue(-1);
  const scrubbingCurl = useSharedValue(false);
  // The spreads the JS side was last told of (`noteScrub`).
  const scrubToldGoal = useSharedValue(-1);
  const scrubToldShown = useSharedValue(-1);
  // What the path animation running on `pathT` is finishing: nothing, a drag's release (and whether
  // it committed), or a tap's turn. Its completion is one worklet, `finishPath`, so a hurried path
  // (landed at once under a new finger) ends the same way as the one it cut short.
  const PATH_NONE = 0;
  const PATH_DRAG = 1;
  const PATH_TAP = 2;
  const pathKind = useSharedValue(PATH_NONE);
  const pathCommitted = useSharedValue(false);
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
      armedFromKey.set(plan.fromKey);
      armedToKey.set(plan.toKey);
      armedTurn.set(turnId(plan));
      armSeq.set(armSeq.value + 1);
    },
    [
      mirroredSV,
      grabY,
      startT,
      endT,
      pullX,
      pullY,
      dragFromX,
      pathT,
      turnLeaf,
      armedFromKey,
      armedToKey,
      armedTurn,
      armSeq,
    ],
  );

  // The last turn's landed hold gives way to a turn armed after it the moment that turn's pictures
  // are in — at its arming or frames later: drawn, it covers the whole pager, stale or not. Held on,
  // it stood over the new drag until the JS side caught up with the landing, a tenth of a second
  // and more, and a quick flick turned the page with nothing drawn.
  useAnimatedReaction(
    () => {
      const l = landed.value;
      if (!l || armSeq.value <= l.seq || armedTurn.value === '') return false;
      let have = 0;
      for (const p of staged.value) if (p.key === armedFromKey.value || p.key === armedToKey.value) have += 1;
      return have >= 2;
    },
    (ready) => {
      if (ready) landed.set(null);
    },
  );

  // ── JS-side state ──
  const inFlight = useRef<InFlight | null>(null);
  const tokens = useRef(0);
  const latest = useRef(options);
  /** A swipe let go before the turn under it had landed, kept to turn once it has — which way it
   *  went (left across the screen or not). One deep: a third swipe in the same beat replaces it. */
  const queued = useRef<boolean | null>(null);
  const playQueued = useRef<() => void>(() => {});
  // Whether the reader last turned forward (in reading order): what is pictured ahead follows it.
  const readingOn = useRef(true);
  // Where the pager is, as of the last turn this hook landed — a second tap in quick succession
  // turns from there, before the render that names it.
  const current = useRef(options.activeIndex);
  // The pictures on hand, by cell, with what they were taken under: whether the cell had its
  // pages by then, the reader's layout (`layoutOf`), and whether it was the page on screen, zoomed
  // — what `staged` mirrors — and the snapshots on their way.
  const cells = useRef(
    new Map<string, { image: SkImage; ready: boolean; layout: string; view: string; content: string }>(),
  );
  // Which view of its cell a picture shows: 'rest', or, of the page being read once the finger has
  // moved it, the move it shows (`viewMoves`). A page left at rest — a wide page resting zoomed,
  // just turned to — keeps the picture taken of it before; pictured fresh for every turn because
  // it was zoomed, each turn from it waited a tenth of a second on the main thread to start.
  const viewMoves = useRef(0);
  // The page being read is being moved — its own pan, a pinch, a fling still gliding — which the
  // curl's own gesture never sees: the page's pan takes those drags from it.
  const viewBusy = useRef(false);
  const readSince = useRef<{ key: string | undefined; moves: number }>({ key: undefined, moves: 0 });
  /** The view of `key` a picture of it has to show to stand for it now. */
  const viewOf = useCallback((key: string): string => {
    const o = latest.current;
    const reading = o.data[current.current]?.key;
    if (reading !== readSince.current.key) readSince.current = { key: reading, moves: viewMoves.current };
    return key === reading && viewMoves.current !== readSince.current.moves ? `moved ${viewMoves.current}` : 'rest';
  }, []);
  const shots = useRef(new Map<string, Promise<SkImage | null>>());
  const alive = useRef(true);
  // The drag in flight, for the trace: when each thread took it up and when it was first drawn.
  const trace = useRef<{
    token: number;
    movingLeft: boolean;
    startedAt: number;
    caughtUpAt: number;
    rearmed: boolean;
    ahead: number;
    drawnAt: number | null;
  } | null>(null);

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

  const publish = useCallback(() => {
    staged.set([...cells.current].map(([key, { image }]) => ({ key, image })));
  }, [staged]);
  // A picture goes once the UI thread has drawn a frame without it: its methods throw once it is
  // disposed, and the curl, finding it still staged there — the staging is applied in that thread's
  // own time, which a snapshot on the main thread holds up — drew a black fill in place of the
  // effect.
  const retiring = useRef(new Map<number, SkImage>());
  const retired = useRef(0);
  const retire = useCallback((id: number) => {
    const image = retiring.current.get(id);
    retiring.current.delete(id);
    image?.dispose();
  }, []);
  /** Run `run` once nothing is moving and no finger is down. A picture is taken on the main
   *  thread, the thread the curl is drawn on, for 30ms and more: taken while a turn was moving it
   *  stopped the turn dead for as long, and the turn then jumped to where its clock said. A turn
   *  that has to start without its pictures still takes them at once (`capture`). */
  // Whether anything moves, as the UI thread last said (the reaction below), and what waits for it to
  // stop, one entry per `key`. Read here, never asked of that thread: a shared value read from this
  // one waits on it, and every picture waiting its turn asking every few frames — hundreds, as a
  // chapter's pages came in during a run of turns — held this thread for seconds, and drags it had
  // to start were let go before it got to them.
  const busyNow = useRef(false);
  const waiting = useRef(new Map<string, () => void>());
  const waitSeq = useRef(0);
  const drainStill = useCallback(() => {
    if (busyNow.current || viewBusy.current || !alive.current) return;
    const runs = [...waiting.current.values()];
    waiting.current.clear();
    for (const run of runs) run();
  }, []);
  const whenStill = useCallback((run: () => void, key?: string) => {
    // Nor while the page is being moved, however long: a picture taken then stopped the pan or the
    // glide under the finger for a tenth of a second.
    if (!busyNow.current && !viewBusy.current) run();
    else waiting.current.set(key ?? `#${++waitSeq.current}`, run);
  }, []);
  const noteBusy = useCallback(
    (busy: boolean) => {
      busyNow.current = busy;
      drainStill();
    },
    [drainStill],
  );
  useAnimatedReaction(
    () => touching.value || dragging.value || pathKind.value !== PATH_NONE || scrubbingCurl.value,
    (busy, previous) => {
      if (busy !== previous) runOnJS(noteBusy)(busy);
    },
  );

  const discard = useCallback(
    (image: SkImage) => {
      const id = ++retired.current;
      retiring.current.set(id, image);
      runOnUI(() => {
        'worklet';
        requestAnimationFrame(() => requestAnimationFrame(() => runOnJS(retire)(id)));
      })();
    },
    [retire],
  );
  const stage = useCallback(
    (key: string, image: SkImage, ready: boolean, layout: string, view: string, content: string) => {
      const old = cells.current.get(key);
      cells.current.set(key, { image, ready, layout, view, content });
      publish();
      if (old) discard(old.image);
    },
    [publish, discard],
  );
  useEffect(
    () => () => {
      alive.current = false;
      for (const { image } of cells.current.values()) image.dispose();
      cells.current.clear();
      for (const shot of shots.current.values()) void shot.then((image) => image?.dispose());
      shots.current.clear();
      for (const image of retiring.current.values()) image.dispose();
      retiring.current.clear();
    },
    [],
  );

  const picture = useCallback((key: string): Promise<SkImage | null> => {
    const view = latest.current.cellView(key);
    if (!view) return Promise.resolve(null);
    return makeImageFromView({ current: view as unknown as number }).catch(() => null);
  }, []);

  /** A picture of this cell, the one on hand where it still stands for the cell — taken under the
   *  same layout, not of the page on screen zoomed, and not before the cell's pages had arrived
   *  when they have since (a picture of a page still loading is of nothing, and drawn for the page
   *  once it is in, the turn was a black page) — otherwise taken. Kept for as long as that holds,
   *  not for a second: retaken as each drag began, after any pause on a page, two pictures held the
   *  main thread for a tenth of a second as the finger set off, and the curl came up well along. `ahead` where it was on hand or already on its way, i.e. not waited for from
   *  here. */
  /** Whether the picture on hand of `key` still stands for it — see `ensureOne`. */
  const stands = useCallback(
    (key: string): boolean => {
      const o = latest.current;
      const have = cells.current.get(key);
      return (
        !!have &&
        have.layout === layoutOf(o) &&
        have.content === contentOf(o, key) &&
        have.view === viewOf(key) &&
        (have.ready || !o.cellReady(key))
      );
    },
    [viewOf],
  );

  const ensureOne = useCallback(
    (key: string): { ahead: boolean; shot: Promise<SkImage | null> } => {
      const o = latest.current;
      const have = cells.current.get(key);
      const ready = o.cellReady(key);
      const layout = layoutOf(o);
      const view = viewOf(key);
      const content = contentOf(o, key);
      if (have && stands(key)) return { ahead: true, shot: Promise.resolve(have.image) };
      // On its way is not ahead: it was most likely asked for as this drag began.
      const going = shots.current.get(key);
      if (going) return { ahead: false, shot: going };
      const shot = picture(key).then((image) => {
        if (shots.current.get(key) === shot) shots.current.delete(key);
        if (!image) return null;
        if (!alive.current) {
          image.dispose();
          return null;
        }
        stage(key, image, ready, layout, view, content);
        return image;
      });
      shots.current.set(key, shot);
      return { ahead: false, shot };
    },
    [picture, stage, stands, viewOf],
  );

  /** The cells the next turn either way from the spread on screen would run between. */
  /** The cells the next turn either way from the spread on screen would run between — and, `beyond`,
   *  those of the turn after it the way the reader last went. */
  const wantedKeys = useCallback((beyond = false) => {
    const o = latest.current;
    const wanted = new Set<string>();
    for (const forward of [true, false]) {
      const plan = o.mode ? planTurn(o, current.current, forward) : null;
      if (plan) {
        wanted.add(plan.fromKey);
        wanted.add(plan.toKey);
      }
    }
    if (beyond && o.mode) {
      const next = planTurn(o, current.current, readingOn.current);
      const after = next ? planTurn(o, next.target, readingOn.current) : null;
      if (after) {
        wanted.add(after.fromKey);
        wanted.add(after.toKey);
      }
    }
    return wanted;
  }, []);

  const pageLoaded = useCallback(
    (key: string) =>
      whenStill(() => {
        // Loaded again (a retry, a page come back into the window), the picture is of what it was.
        const have = cells.current.get(key);
        if (!have) return;
        if (wantedKeys().has(key)) {
          ensureOne(key);
          return;
        }
        cells.current.delete(key);
        discard(have.image);
        publish();
      }, `loaded|${key}`),
    [whenStill, wantedKeys, ensureOne, discard, publish],
  );

  /** Let go of every picture but the next turns' (either way from the spread on screen, and the one
   *  after the way the reader is going), once nothing is drawn. */
  const sweep = useCallback((keep?: Set<string>) => {
    const wanted = wantedKeys(true);
    for (const key of keep ?? []) wanted.add(key);
    let changed = false;
    for (const [key, { image }] of cells.current) {
      if (wanted.has(key)) continue;
      cells.current.delete(key);
      discard(image);
      changed = true;
    }
    if (changed) publish();
  }, [wantedKeys, discard, publish]);

  /** Pictures of these cells on their way, where no fresh one is: for a drag starting across, and
   *  for the quiet after a landing. */
  const ensure = useCallback(
    (keys: Iterable<string>) => {
      for (const key of keys) ensureOne(key);
    },
    [ensureOne],
  );

  /** Picture the two cells a drag starting across this way would turn between. */
  const prepare = useCallback(
    (movingLeft: boolean) => {
      if (inFlight.current) return;
      // A page's shape may have arrived since the last render: the plan the drag arms from is fresh.
      replan();
      const plan = planTurn(latest.current, current.current, movingLeft !== latest.current.rtl);
      if (!plan) return;
      ensure([plan.fromKey, plan.toKey]);
    },
    [replan, ensure],
  );

  /** The pictures the next turn either way would take, in the quiet after a landing: a fast run of
   *  turns gets each curl up as the drag begins, not a snapshot and a half later. */
  const warm = useCallback(() => {
    // One picture at a time, each only once nothing moves: taken together they held the main thread
    // for two and three tenths of a second, and a drag set off in it waited for all of them.
    // Each taken once a warm: a picture that still doesn't stand once taken (the view moved on as it
    // was taken) waits for the next warm, never again at once — asked for again at once, a page
    // whose picture never stood was taken over and over for as long as it was looked at.
    const tried = new Set<string>();
    const step = () =>
      whenStill(() => {
        // A turn under way has its pictures; its landing warms again.
        if (inFlight.current || !latest.current.mode) return;
        // Two turns ahead the way the reader is going, not one: the page a landing would otherwise
        // have to picture as it lands is in hand by then. Pictured at the landing, in a fast run it
        // held the main thread just as the next finger came down, and that drag set off late.
        const key = [...wantedKeys(true)].find((k) => !tried.has(k) && !stands(k) && !shots.current.has(k));
        if (key) tried.add(key);
        if (key) void ensureOne(key).shot.then(step);
      }, 'warm');
    step();
  }, [whenStill, wantedKeys, stands, ensureOne]);

  const warmAfterMove = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const viewBusyLapse = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** The finger is moving the view of the page being read, or has stopped: its picture, of the view
   *  before, goes at once — drawn by a turn begun before the new one was in, it showed the page jump
   *  back to where it lay and then on to where it is — and a new one is taken once the view has come
   *  to rest. */
  const viewMoving = useCallback(
    (moving: boolean) => {
      viewMoves.current += 1;
      viewBusy.current = moving;
      clearTimeout(viewBusyLapse.current);
      // A stop that never came (a gesture cut off) frees the pictures before long all the same.
      if (moving) {
        viewBusyLapse.current = setTimeout(() => {
          viewBusy.current = false;
          drainStill();
        }, VIEW_BUSY_LAPSE_MS);
      }
      const key = latest.current.data[current.current]?.key;
      const have = key ? cells.current.get(key) : undefined;
      if (key && have && have.view !== viewOf(key)) {
        cells.current.delete(key);
        discard(have.image);
        publish();
      }
      clearTimeout(warmAfterMove.current);
      if (!moving) {
        warmAfterMove.current = setTimeout(() => {
          drainStill();
          warm();
        }, VIEW_WARM_MS);
      }
    },
    [viewOf, discard, publish, warm, drainStill],
  );
  useEffect(
    () => () => {
      clearTimeout(warmAfterMove.current);
      clearTimeout(viewBusyLapse.current);
    },
    [],
  );

  /** Both pictures, the ones on hand where there are, and `ready` once they are in — the curl is
   *  drawn from the moment they are — unless the turn has moved on. A cell that can't be pictured
   *  (not drawn yet) leaves nothing to show, and `failed` decides what then. */
  const capture = useCallback(
    (flight: InFlight, ready: () => void, failed: () => void) => {
      const a = ensureOne(flight.fromKey);
      const b = ensureOne(flight.toKey);
      void Promise.all([a.shot, b.shot]).then(([from, to]) => {
        if (inFlight.current?.token !== flight.token) return;
        if (!from || !to) {
          failed();
          return;
        }
        const t = trace.current;
        if (flight.fromDrag && t?.token === flight.token) {
          t.ahead = (a.ahead ? 1 : 0) + (b.ahead ? 1 : 0);
          t.drawnAt = t.ahead === 2 ? t.startedAt : Date.now();
        }
        ready();
      });
    },
    [ensureOne],
  );

  /** One line on how a drag went: to the diagnostics log where it lagged, to Metro's console under
   *  a development build either way. */
  const reportDrag = useCallback((token: number, committed: boolean) => {
    const t = trace.current;
    if (t?.token !== token) return;
    trace.current = null;
    const behind = t.caughtUpAt - t.startedAt;
    const drawn = t.drawnAt === null ? null : t.drawnAt - t.startedAt;
    const summary =
      `A drag ${t.movingLeft ? 'left' : 'right'} ${committed ? 'turned the page' : 'fell back'}: ` +
      `the JS side caught up ${behind}ms in; ` +
      (drawn === null ? 'never drawn, its pictures not in before it landed' : `drawn ${drawn}ms in, ${t.ahead} of 2 pictures taken ahead`) +
      (t.rearmed ? '; re-armed, the pager had moved under it' : '') +
      '.';
    if (drawn === null || drawn > SLOW_MS || behind > SLOW_MS || t.rearmed) logDiagnostic('page-curl', summary);
    else if (__DEV__) console.log(`[page-curl] ${summary}`);
  }, []);

  /** A touch that went far enough to decide and never turned a page. */
  const reportMissed = useCallback((why: number, dx: number, dy: number) => {
    const reason =
      why === ASKED
        ? 'another gesture took the touch before it could start'
        : why === OFF
          ? 'turning was off (the entrance strip, a pinch)'
          : 'steeper than 45°';
    logDiagnostic('page-curl', `A drag ${dx < 0 ? 'left' : 'right'} didn't turn: ${reason}.`, {
      context: `${Math.round(dx)}, ${Math.round(dy)}pt at the decision${latest.current.zoomed ? '; the page was zoomed' : ''}`,
    });
  }, []);

  /** The curl put away once a turn is done with, on the UI thread, where nothing can arm in
   *  between: the turn `id` let go of if it is still the one landed, and disarmed if no drag or
   *  path has taken the curl up since. Done from the JS side, which runs a frame and more behind it
   *  after a landing, it cleared the turn a quick next drag had just armed, and that drag turned
   *  the page with nothing drawn. */
  const putAway = useCallback(
    (id: string) => {
      'worklet';
      if (landed.value?.id === id) landed.set(null);
      if (!dragging.value && pathKind.value === PATH_NONE && armedTurn.value === id) armedTurn.set('');
    },
    [landed, dragging, pathKind, armedTurn],
  );

  const finish = useCallback(
    (token: number, committed: boolean) => {
      const flight = inFlight.current;
      if (!flight || flight.token !== token) return;
      inFlight.current = null;
      if (flight.fromDrag) reportDrag(token, committed);
      // Only if nothing has started since: a turn asked for straight after this one owns the curl.
      // The UI thread's numbers are left as they are: a drag may already have armed the next turn
      // over them.
      // Disarmed too, so nothing is drawn at rest (the pictures stay for the next turn): the last
      // turn's pictures, lying flat over the pager, hid a page that loaded or zoomed under them.
      const clear = () => {
        if (inFlight.current) return;
        runOnUI(putAway)(turnId(flight));
        sweep();
        playQueued.current();
      };
      if (!committed) {
        clear();
        return;
      }
      // Where the cell turned to is now: the spreads may have paired again under the turn.
      const found = latest.current.data.findIndex((c) => c.key === flight.targetKey);
      const target = found >= 0 ? found : flight.target;
      // Which way the reader is going, for what is pictured ahead (`wantedKeys`).
      readingOn.current = latest.current.rtl ? target < current.current : target > current.current;
      current.current = target;
      replan();
      // The next turns' pictures now, while the landed spread is held flat and nothing moves: a
      // picture stops the main thread, and taken later, in a fast run, it fell inside the next
      // drag. Mostly one, the page beyond; the two the turn ran between are on hand.
      ensure(wantedKeys());
      latest.current.land(target, flight.fromDrag);
      requestAnimationFrame(() => requestAnimationFrame(clear));
      setTimeout(warm, WARM_MS);
    },
    [replan, reportDrag, warm, sweep, putAway, ensure, wantedKeys],
  );

  /** The plans the UI thread takes up when the turn in flight lands on `target`. */
  const planAhead = useCallback(
    (target: number) => {
      const o = latest.current;
      nextPlanLeft.set(planTurn(o, target, !o.rtl));
      nextPlanRight.set(planTurn(o, target, o.rtl));
    },
    [nextPlanLeft, nextPlanRight],
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

  const releaseDrag = useCallback(
    (committed: boolean) => {
      const flight = inFlight.current;
      if (flight?.fromDrag) finish(flight.token, committed);
    },
    [finish],
  );
  // A tap's turn, once its path has run: whichever tap is in flight by then.
  const releaseTap = useCallback(() => {
    const flight = inFlight.current;
    if (flight && !flight.fromDrag) finish(flight.token, true);
  }, [finish]);

  /** The end of the path animation, from the UI thread: the turn has landed (held there, flat, for
   *  the pager to catch up — see `landed`) or fallen back, and the JS side is told which. */
  const finishPath = useCallback(() => {
    'worklet';
    const kind = pathKind.value;
    pathKind.set(PATH_NONE);
    if (kind === PATH_NONE) return;
    const committed = kind === PATH_TAP || pathCommitted.value;
    const leaf = turnLeaf.value;
    if (committed && leaf) {
      // From the path's end, not `frame`: cut short under a finger, the frame is still where the
      // path was, its derived value a frame behind the pull.
      const end = pathArc.value ? turnPull(leaf, grabY.value, endT.value) : { x: pathToX.value, y: pathToY.value };
      landed.set({
        id: armedTurn.value,
        leaf,
        mirrored: mirroredSV.value,
        fromKey: armedFromKey.value,
        toKey: armedToKey.value,
        frame: curlFrame(leaf, grabY.value, end.x, end.y),
        seq: armSeq.value,
      });
      planLeft.set(nextPlanLeft.value);
      planRight.set(nextPlanRight.value);
    }
    if (kind === PATH_TAP) runOnJS(releaseTap)();
    else runOnJS(releaseDrag)(committed);
  }, [
    pathKind,
    pathCommitted,
    turnLeaf,
    landed,
    armedTurn,
    mirroredSV,
    armedFromKey,
    armedToKey,
    pathArc,
    grabY,
    endT,
    pathToX,
    pathToY,
    armSeq,
    planLeft,
    planRight,
    nextPlanLeft,
    nextPlanRight,
    releaseTap,
    releaseDrag,
  ]);

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
      planAhead(plan.target);
      arm(plan, plan.leaf.box.y + plan.leaf.box.height * TAP_GRAB);
      capture(
        flight,
        () => {
          pathArc.set(true);
          pathKind.set(PATH_TAP);
          pathT.set(0);
          pathT.set(
            withTiming(1, { duration: TAP_TURN_MS, easing: Easing.inOut(Easing.cubic) }, (done) => {
              'worklet';
              if (done) finishPath();
            }),
          );
        },
        // Nothing to animate: the turn lands at once, as a slide-mode tap does.
        () => finish(token, true),
      );
      return true;
    },
    [settleNow, planAhead, arm, capture, finish, pathArc, pathT, dragging, releasedCommitted, pathKind, finishPath],
  );

  const queueFlick = useCallback((movingLeft: boolean) => {
    queued.current = movingLeft;
    logDiagnostic('page-curl', `A swipe ${movingLeft ? 'left' : 'right'} during a landing: turning once it has landed.`);
  }, []);
  useEffect(() => {
    playQueued.current = () => {
      const movingLeft = queued.current;
      queued.current = null;
      if (movingLeft === null) return;
      const o = latest.current;
      const plan = planTurn(o, current.current, movingLeft !== o.rtl);
      if (plan) turnTo(plan.target);
    };
  }, [turnTo]);

  // ── Scrubbing ──
  // A scrub in curl mode turns the pages after the scrubber: the pager stands on the spread under
  // the scrubber, and the curl over it turns through the pages on a clock of its own (`scrubAt`),
  // from pictures drawn off the main thread (`scrubPicture`) — a cell's own picture, taken there,
  // stopped the turns dead each time — save where the cell's own is in hand.
  const scrubOffered = useRef(new Set<number>());
  const scrubPumping = useRef(false);
  const scrubLive = useRef(false);

  /** A picture of `key` for the scrub: the cell's own where it stands, otherwise one drawn from its
   *  pages, kept under its own key beside the cell's. */
  const scrubShot = useCallback(
    async (key: string): Promise<string | null> => {
      if (stands(key)) return key;
      const o = latest.current;
      const drawn = `scrub|${key}`;
      const layout = layoutOf(o);
      const content = contentOf(o, key);
      const have = cells.current.get(drawn);
      if (have?.layout === layout && have.content === content) return drawn;
      const cell = o.data.find((c) => c.key === key);
      if (!cell) return null;
      const image = await scrubPicture(cell, o).catch(() => null);
      if (!image) return null;
      if (!alive.current) {
        image.dispose();
        return null;
      }
      stage(drawn, image, true, layout, 'rest', content);
      return drawn;
    },
    [stands, stage],
  );

  /** Hand the UI thread a pair whose pictures are in, and let go of those far from the scrub. */
  const offerPair = useCallback(
    (plan: Plan, base: number, keepFrom: number, keepTo: number) => {
      'worklet';
      const pairs: Record<string, Plan> = {};
      for (const [b, kept] of Object.entries(scrubPairs.value)) {
        if (Number(b) >= keepFrom && Number(b) <= keepTo) pairs[b] = kept;
      }
      pairs[String(base)] = plan;
      scrubPairs.set(pairs);
    },
    [scrubPairs],
  );

  /** Draw the pairs the scrub's turns will reach — from the turn shown toward the scrubber, and a
   *  few on past it the way it is going — nearest first, for as long as a scrub runs. */
  // Where the scrub is and where its turns are, in whole spreads, as the UI thread last said
  // (`noteScrub`): read here, not asked of that thread, for the same reason as `busyNow`.
  const scrubGoal = useRef(-1);
  const scrubShown = useRef(-1);
  const pumpScrub = useCallback(async () => {
    if (scrubPumping.current) return;
    scrubPumping.current = true;
    try {
      while (scrubLive.current) {
        const o = latest.current;
        const at = (b: number) => (o.rtl ? o.data.length - 1 - b : b);
        const goal = scrubGoal.current;
        const from = scrubShown.current >= 0 ? scrubShown.current : goal;
        // Nothing to draw until the scrub moves on: `noteScrub` starts this again then.
        if (goal < 0) return;
        const way = goal >= from ? 1 : -1;
        // From the turn shown to the scrubber (no further back than a skip leaves), and on past it.
        const wanted: number[] = [];
        const start = Math.abs(goal - from) > SCRUB_SKIP ? goal - way * SCRUB_SKIP_TO : from;
        for (let b = start; way > 0 ? b <= goal + SCRUB_AHEAD : b >= goal - SCRUB_AHEAD; b += way) wanted.push(b);
        // A turn back from the spread shown turns on from the one before it.
        if (way < 0) wanted.unshift(from);
        const next = wanted.find((b) => b >= 0 && b < o.data.length - 1 && !scrubOffered.current.has(b));
        if (next === undefined) return;
        scrubOffered.current.add(next);
        const plan = planTurn(o, at(next), true);
        if (!plan) continue;
        const fromKey = await scrubShot(plan.fromKey);
        const toKey = await scrubShot(plan.toKey);
        if (!scrubLive.current) return;
        if (!fromKey || !toKey) {
          scrubOffered.current.delete(next);
          // Tried again in a moment (a page not yet sized or read), not in a loop.
          setTimeout(() => void pumpScrubRef.current(), 250);
          return;
        }
        // The window kept: every pair `wanted` can name, the look-ahead included whichever way the
        // scrub goes. One short of it going back, a pair drawn behind the scrubber was let go as soon
        // as it was offered and offered again at once, a loop that held both threads.
        const lo = Math.min(start, from, goal - (way < 0 ? SCRUB_AHEAD : 0)) - 1;
        const hi = Math.max(start, from, goal + (way > 0 ? SCRUB_AHEAD : 0)) + 1;
        runOnUI(offerPair)({ ...plan, fromKey, toKey }, next, lo, hi);
        for (const b of scrubOffered.current) if (b < lo || b > hi) scrubOffered.current.delete(b);
        // Only the pictures about the scrub are kept, and for each cell one: its own, or one drawn.
        const near = new Set<string>();
        for (let b = lo; b <= hi + 1; b++) {
          const cell = o.data[at(b)];
          if (cell) near.add(stands(cell.key) ? cell.key : `scrub|${cell.key}`);
        }
        sweep(near);
      }
    } finally {
      scrubPumping.current = false;
    }
  }, [scrubShot, offerPair, sweep, stands]);
  const pumpScrubRef = useRef(pumpScrub);
  useEffect(() => {
    pumpScrubRef.current = pumpScrub;
  }, [pumpScrub]);
  const noteScrub = useCallback(
    (goal: number, shown: number) => {
      scrubGoal.current = goal;
      scrubShown.current = shown;
      void pumpScrub();
    },
    [pumpScrub],
  );

  // The frame callback below, for the JS side to stop: it calls back here when its turns have landed.
  const framesRef = useRef<ReturnType<typeof useFrameCallback> | null>(null);
  const scrubBackstop = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Its turns have landed where the scrubber left the reader.
  const scrubFinished = useCallback(() => {
    scrubLive.current = false;
    scrubOffered.current.clear();
    scrubGoal.current = -1;
    scrubShown.current = -1;
    clearTimeout(scrubBackstop.current);
    framesRef.current?.setActive(false);
    // The rest let go, and what the reader turns to next pictured once the hand has had a moment
    // to come back to the page: a picture taken as a swipe begins holds that swipe up.
    setTimeout(() => {
      sweep();
      warm();
    }, SCRUB_WARM_MS);
  }, [sweep, warm]);

  /** A scrub's turns are over: the curl goes, from wherever its turns had got to, and the JS side is
   *  told. Where a release can't be reached — the pair on to it can't be drawn — the scrub ends
   *  there rather than waiting at the page's edge for good, the reader counted busy all the while. */
  const endScrub = useCallback(() => {
    'worklet';
    if (!scrubbingCurl.value) return;
    armedTurn.set('');
    scrubbingCurl.set(false);
    scrubAt.set(-1);
    scrubBase.set(-1);
    scrubLanding.set(-1);
    scrubPairs.set({});
    runOnJS(scrubFinished)();
  }, [scrubbingCurl, armedTurn, scrubAt, scrubBase, scrubLanding, scrubPairs, scrubFinished]);

  const frames = useFrameCallback((frame) => {
    'worklet';
    if (!scrubbingCurl.value) return;
    const landing = scrubLanding.value;
    const goal = landing >= 0 ? landing : scrubPos.value;
    if (goal < 0) return;
    const dt = Math.min(0.05, (frame.timeSincePreviousFrame ?? 16) / 1000);
    let pos = scrubAt.value < 0 ? goal : scrubAt.value;
    let speed = scrubSpeed.value;
    // A fling far ahead: on to just short of it, the turns shown so far put away.
    if (Math.abs(goal - pos) > SCRUB_SKIP) {
      pos = goal - Math.sign(goal - pos) * SCRUB_SKIP_TO;
      scrubBase.set(-1);
      armedTurn.set('');
    }
    const gap = goal - pos;
    const max = Math.min(SCRUB_MAX_SPEED, SCRUB_MIN_SPEED + Math.abs(gap) * SCRUB_SPEED_PER_SPREAD);
    const wanted = Math.max(-max, Math.min(max, gap * SCRUB_GAIN));
    // Up to speed gently; down from it at once, and never on past the scrub's position.
    const speedingUp = Math.sign(wanted) === Math.sign(speed) ? Math.abs(wanted) > Math.abs(speed) : wanted !== 0;
    speed = speedingUp ? speed + (wanted - speed) * Math.min(1, dt * SCRUB_ACCEL) : wanted;
    let next = pos + speed * dt;
    if ((goal - next) * gap < 0) {
      next = goal;
      speed = 0;
    }
    // Into a pair only once its pictures are in: until then, held at the edge of the turn shown.
    const base = Math.floor(next);
    const shown = armedTurn.value === '' ? -1 : scrubBase.value;
    if (base !== shown) {
      const plan = scrubPairs.value[String(base)];
      if (plan) {
        arm(plan, plan.leaf.box.y + plan.leaf.box.height * TAP_GRAB);
        pathArc.set(true);
        scrubBase.set(base);
        // Where the scrub is in it, now: `arm` lays the turn flat at its start, and a pair come into
        // going back is entered at its far end — left to the next frame, its first page flashed.
        const pull = turnPull(plan.leaf, grabY.value, plan.startT + (plan.endT - plan.startT) * (next - base));
        pullX.set(pull.x);
        pullY.set(pull.y);
        pathT.set(next - base);
      } else if (shown >= 0) {
        if (landing >= 0) {
          endScrub();
          return;
        }
        next = base > shown ? shown + 0.9999 : shown;
        speed = 0;
      }
    }
    scrubAt.set(next);
    scrubSpeed.set(speed);
    // The JS side draws the pairs the turns will reach: told when the scrub or its turns cross a
    // spread, never asking.
    const goalSpread = Math.floor(goal);
    const shownSpread = Math.floor(next);
    if (goalSpread !== scrubToldGoal.value || shownSpread !== scrubToldShown.value) {
      scrubToldGoal.set(goalSpread);
      scrubToldShown.set(shownSpread);
      runOnJS(noteScrub)(goalSpread, shownSpread);
    }
    if (scrubBase.value === Math.floor(next) && armedTurn.value !== '') pathT.set(next - Math.floor(next));
    // A released scrub, landed: the pager has gone there under the curl, which goes.
    if (landing >= 0 && Math.abs(goal - next) < 0.002 && Math.abs(speed) < 0.05) {
      if (scrubBase.value >= 0) pathT.set(Math.round(next) === scrubBase.value ? 0 : 1);
      endScrub();
    }
  }, false);

  // A scrub begins: a turn under way lands where it was going, and the scrub's turns start.
  const scrubBegan = useCallback(() => {
    queued.current = null;
    settleNow(releasedCommitted.value);
    scrubOffered.current.clear();
    scrubLive.current = true;
    frames.setActive(true);
  }, [settleNow, releasedCommitted, frames]);
  // Let go: the turns run on to where it lands, and if they haven't got there in a moment and a
  // half (a page there can't be drawn, the frames held up), the scrub ends anyway.
  const scrubReleased = useCallback(() => {
    clearTimeout(scrubBackstop.current);
    scrubBackstop.current = setTimeout(() => {
      if (scrubLive.current) runOnUI(endScrub)();
    }, SCRUB_END_MS);
  }, [endScrub]);
  useEffect(() => () => clearTimeout(scrubBackstop.current), []);
  useEffect(() => {
    framesRef.current = frames;
  }, [frames]);

  useAnimatedReaction(
    () => scrubPos.value,
    (pos, prev) => {
      if (pos < 0) {
        // Released: the turns run on to the spread the scrubber left the reader on, the nearer.
        if (scrubbingCurl.value && (prev ?? -1) >= 0 && scrubLanding.value < 0) {
          scrubLanding.set(Math.round(prev!));
          runOnJS(scrubReleased)();
        }
        return;
      }
      scrubLanding.set(-1);
      if (!scrubbingCurl.value) {
        scrubbingCurl.set(true);
        scrubAt.set(-1);
        scrubSpeed.set(0);
        scrubToldGoal.set(-1);
        scrubToldShown.set(-1);
        runOnJS(scrubBegan)();
      }
    },
  );

  /**
   * The JS side of a drag the UI thread has armed with `armed`: the turn in flight, and its
   * pictures. The pager may have moved since that plan was made — a turn landing as the finger came
   * down — and then the drag is re-armed from where it is now, or dropped if it was already let go.
   */
  const beginDrag = useCallback(
    (armed: Plan | null, movingLeft: boolean, y: number, startedAt: number) => {
      settleNow(releasedCommitted.value);
      const o = latest.current;
      const fresh = planTurn(o, current.current, movingLeft !== o.rtl);
      const rearmed = !armed || !fresh || fresh.fromKey !== armed.fromKey || fresh.toKey !== armed.toKey;
      let plan: Plan;
      if (!armed || rearmed) {
        if (!fresh || !fingerDown.value) {
          dragging.set(false);
          logDiagnostic('page-curl', `A drag ${movingLeft ? 'left' : 'right'} didn't turn: the pager moved under it.`, {
            context: `the JS side caught up ${Date.now() - startedAt}ms in, ${fresh ? 'after the finger had lifted' : 'with no page that way any more'}`,
          });
          return;
        }
        plan = fresh;
        arm(plan, dragGrabY(plan.leaf, y));
        dragging.set(true);
      } else {
        plan = armed;
      }
      const token = ++tokens.current;
      const flight: InFlight = { ...plan, token, fromDrag: true };
      inFlight.current = flight;
      planAhead(plan.target);
      trace.current = { token, movingLeft, startedAt, caughtUpAt: Date.now(), rearmed, ahead: 0, drawnAt: null };
      o.onDragBegin?.();
      // Without pictures the drag still turns the page on release; it just isn't drawn curling.
      capture(flight, () => {}, () => {});
    },
    [settleNow, planAhead, arm, capture, fingerDown, dragging, releasedCommitted],
  );

  // A drag's release, once the turn has finished on its own from where the finger left it. The
  // token is whichever drag is in flight by then.
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(mode)
        .maxPointers(1)
        .manualActivation(true)
        // eslint-disable-next-line react-hooks/refs -- a worklet: it reaches the in-flight turn (via finishPath) only when a finger comes down, never during this render.
        .onTouchesDown((e) => {
          'worklet';
          touching.set(true);
          const t = e.allTouches[0];
          if (!t || e.numberOfTouches !== 1) return;
          downX.set(t.x);
          downY.set(t.y);
          baseX.set(t.x);
          baseY.set(t.y);
          decided.set(false);
          preparing.set(false);
          verdict.set(0);
          started.set(false);
          waitDx.set(0);
          waitDy.set(0);
          // A turn still finishing lands under the finger at once, and the drag starts from the
          // page it was going to with no wait: a fast run of turns goes as fast as the finger.
          if (!dragging.value && pathKind.value !== PATH_NONE) {
            cancelAnimation(pathT);
            // At its end, so one falling back lies flat rather than half-curled until it is put away.
            pathT.set(1);
            finishPath();
          }
        })
        // eslint-disable-next-line react-hooks/refs -- a worklet: it reaches the prepared pictures (via prepare) only as a finger moves, never during this render.
        .onTouchesMove((e, state) => {
          'worklet';
          if (decided.value) return;
          const t = e.allTouches[0];
          if (!t) return;
          // The last turn is still landing (hurried, above): decide once it has, from where the
          // finger is by then — or, let go before then, from how far it went (`onFinalize`).
          if (pathKind.value !== PATH_NONE) {
            waitDx.set(t.x - downX.value);
            waitDy.set(t.y - downY.value);
            baseX.set(t.x);
            baseY.set(t.y);
            return;
          }
          const dx = t.x - baseX.value;
          const dy = t.y - baseY.value;
          const across = Math.abs(dx) >= Math.abs(dy);
          // A zoomed page's own pan most likely takes the drag; its pictures wait for the turn.
          if (!preparing.value && allowed.value && !zoomedSV.value && across && Math.abs(dx) >= PREPARE_PX) {
            preparing.set(true);
            runOnJS(prepare)(dx < 0);
          }
          if (Math.hypot(dx, dy) < ACTIVATE_PX) return;
          decided.set(true);
          decidedLeft.set(dx < 0);
          verdictDx.set(dx);
          verdictDy.set(dy);
          verdict.set(
            !allowed.value ? OFF : !across ? STEEP : !(dx < 0 ? planLeft.value : planRight.value) ? NO_PAGE : ASKED,
          );
          if (verdict.value === ASKED) state.activate();
          else state.fail();
        })
        // eslint-disable-next-line react-hooks/refs -- a worklet: it reaches the in-flight turn (via beginDrag) only when a drag starts, never during this render.
        .onStart((e) => {
          'worklet';
          const movingLeft = decidedLeft.value;
          // Null for a moment after a landing: the JS side is re-planning for the page landed on
          // while this thread is already starting the next drag. The drag starts anyway, unarmed,
          // and `beginDrag` arms it from where the pager is by then, or drops it there, with why.
          const plan = movingLeft ? planLeft.value : planRight.value;
          fingerDown.set(true);
          started.set(true);
          // The pull follows the finger from where it came DOWN, not from where the drag activated:
          // a manually activated pan's translation starts over at activation, ten points in, and
          // measured from there the page lay flat with the finger still ten points short of where
          // it began, a stop before the end of every return. The ten points it is in by at
          // activation are eased in (`dragTravel`), not drawn at once.
          originX.set(e.translationX - verdictDx.value);
          originY.set(e.translationY - verdictDy.value);
          if (plan) {
            arm(plan, dragGrabY(plan.leaf, e.y));
            dragging.set(true);
          }
          // eslint-disable-next-line react-hooks/purity -- a worklet: the clock is read when a drag starts, for the trace, never during this render.
          runOnJS(beginDrag)(plan, movingLeft, e.y, Date.now());
        })
        .onUpdate((e) => {
          'worklet';
          const leaf = turnLeaf.value;
          if (!dragging.value || !leaf) return;
          const raw = (mirroredSV.value ? -1 : 1) * (e.translationX - originX.value);
          // The way the turn goes from where it starts: over (left, in turn space), or back.
          const way = startT.value === 0 ? -1 : 1;
          const tx = way * dragTravel(way * raw);
          const pull = dragPull(leaf, grabY.value, dragFromX.value, tx, e.translationY - originY.value);
          pullX.set(pull.x);
          pullY.set(pull.y);
        })
        // eslint-disable-next-line react-hooks/refs -- a worklet: it reaches the in-flight turn (via finishPath) only once a released drag has finished turning, never during this render.
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
          pathKind.set(PATH_DRAG);
          pathCommitted.set(committed);
          pathT.set(0);
          pathT.set(
            withTiming(
              1,
              { duration: 140 + (220 * distance) / Math.max(1, leaf.box.width * 2), easing: Easing.out(Easing.cubic) },
              (done) => {
                'worklet';
                if (done) finishPath();
              },
            ),
          );
        })
        // eslint-disable-next-line react-hooks/refs -- a worklet: it reaches the trace (via reportMissed) only once the touch is over, never during this render.
        .onFinalize(() => {
          'worklet';
          fingerDown.set(false);
          touching.set(false);
          // A swipe over in the frames a landing took: not dropped, turned once the landing is done.
          if (!decided.value && Math.abs(waitDx.value) >= ACTIVATE_PX && Math.abs(waitDx.value) >= Math.abs(waitDy.value)) {
            runOnJS(queueFlick)(waitDx.value < 0);
            return;
          }
          const why = verdict.value;
          const dx = verdictDx.value;
          const dy = verdictDy.value;
          // A steep drag is only worth a line where it was nearly across: a swipe down is not a turn.
          if ((why === ASKED && !started.value) || why === OFF || (why === STEEP && Math.abs(dx) * 2 >= Math.abs(dy))) {
            runOnJS(reportMissed)(why, dx, dy);
          }
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
      decidedLeft,
      preparing,
      originX,
      originY,
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
      verdict,
      verdictDx,
      verdictDy,
      started,
      reportMissed,
      pathKind,
      pathCommitted,
      finishPath,
      waitDx,
      waitDy,
      queueFlick,
      touching,
      baseX,
      baseY,
    ],
  );

  const overlay = mode ? (
    <PageCurl
      pictures={staged}
      armed={armedTurn}
      armedFromKey={armedFromKey}
      armedToKey={armedToKey}
      leaf={turnLeaf}
      mirrored={mirroredSV}
      frame={frame}
      landed={landed}
      width={width}
      height={height}
    />
  ) : null;
  return { pan, turnTo, pageLoaded, scrub: scrubPos, viewMoving, overlay };
}
