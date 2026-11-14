import type * as THREE from 'three/webgpu';

import {
  DISPLAY,
  SHELF,
  displayRow,
  displayScrubbed,
  displaySettles,
  driftAt,
  hoveredPlace,
  placeDisplay,
  placeShelf,
  posAtRow,
  pressedPlace,
  rowAt,
  rowSpacing,
  rubberBand,
  settleOn,
  shelfMiddle,
  shelfCallouts,
  type ShelfBook,
  type ShelfCallouts,
  type ShelfMotion,
  type ShelfStage,
} from '@/lib/bookshelf';

import type { ShelfBookSpec, ShelfScene } from './scene';

const STIFFNESS = 190;
const DAMPING = 25;
/** The press: a stiff spring into the shelf under a finger, and a looser one out of it that
 *  overshoots, which is the book coming forward. `knock` is the speed a tap gives a book that has
 *  not had time to be pressed, per second, and `wait` the longest the tap's page is held for the
 *  book to come out, in milliseconds. */
const PRESS_IN = { stiffness: 1500, damping: 60 };
const PRESS_OUT = { stiffness: 620, damping: 21 };
const PRESS_KNOCK = 9;
const PRESS_WAIT = 260;
/** How fast a spine comes off the shelf under the pointer and goes back, per second: an easing, not
 *  a spring — a pointer crossing the shelf would set a row of springs ringing. */
const HOVER_RATE = 18;
/** The books beside one on display settling into its gap: loose, so they rock once as they land. */
const SETTLE = { stiffness: 150, damping: 9 };

/**
 * The shelf in motion, outside React: where along it the reader is, the drag and the spring that
 * settles it, the press of a tap, the view's drift, and the one place a frame is drawn from. It
 * holds what the scene is to show until there is a scene to show it — the renderer starts later
 * than the first books arrive.
 *
 * It keeps no clock of its own. Whoever owns the frames calls `step` with each, and is told through
 * `setFrames` when the shelf NEEDS them (something is moving) and when it has stopped needing them;
 * a frame handed over while nothing moves is still drawn, which is how the idle drift is paced from
 * outside. The frames are the display's own, since React Native's `requestAnimationFrame` ticks at
 * 60 whatever the screen does.
 */
export class ShelfDriver {
  private onFrame: (callouts: ShelfCallouts) => void = () => {};
  private onFront: (key: string, byHand: boolean) => void = () => {};
  private onDrawn: (drawn: boolean) => void = () => {};
  private still = false;

  private scene: ShelfScene | null = null;
  private specs: readonly ShelfBookSpec[] = [];
  private books: readonly ShelfBook[] = [];
  private covers = new Map<string, { texture: THREE.Texture; aspect: number }>();
  private stage: ShelfStage = { width: 0, height: 0 };
  private pixelRatio = 1;
  private theme = { dark: false, background: '#ffffff' };
  private pos = 0;
  private velocity = 0;
  private target = 0;
  private held = false;
  private grabbedAt = 0;
  private frames = { start: () => {}, stop: () => {} };
  private moving = false;
  /** The reader has moved the shelf at least once: what came forward before that came by itself. */
  private touched = false;
  private last = 0;
  /** The book last told to `onFront`, by its key: where it stands changes with the shelf's order. */
  private front: string | undefined;
  /** How far the front book is pressed into the shelf (below 0 it has sprung out past rest), how
   *  fast, whether a finger is on it, and what its tap opens once it has come back out. */
  private press = 0;
  private pressVelocity = 0;
  private pressing = false;
  private onPressed: (() => void) | null = null;
  private releasedAt = 0;
  private drift = { yaw: 0, pitch: 0 };
  /** The book under the pointer (web, or a pointer on a tablet), or -1; and how far each book has
   *  come off the shelf for it, 0 to 1. */
  private hovered = -1;
  private lifts: number[] = [];
  private motion: ShelfMotion = 'carousel';
  /** A display row: where each book stands along it, and where along it a drag began. */
  private row: number[] = [];
  private grabbedRow = 0;
  /** The book on display and how far it has come out, 0 to 1; and how far each book leans into the
   *  gap beside it, in degrees, and how fast. */
  private shown = { index: 0, amount: 0 };
  private settles: number[] = [];
  private settleVelocities: number[] = [];

  get focused(): number {
    return this.target;
  }

  /** `onFrame` is given each frame's callouts, for the views drawn over the stage; `onFront` the
   *  book in front when it changes, and whether the reader brought it there; `onDrawn` whether
   *  there are books on screen for the callouts to stand on, which there are not until the renderer
   *  has started. */
  listen(to: {
    onFrame: (callouts: ShelfCallouts) => void;
    onFront: (key: string, byHand: boolean) => void;
    onDrawn: (drawn: boolean) => void;
  }) {
    this.onFrame = to.onFrame;
    this.onFront = to.onFront;
    this.onDrawn = to.onDrawn;
    this.front = undefined;
    this.draw();
  }

  /** `start` is called when the shelf begins to need a frame every frame, `stop` when it no longer
   *  does. */
  setFrames(frames: { start: () => void; stop: () => void }) {
    this.frames = frames;
    if (this.moving) frames.start();
  }

  /** Reduce Motion: a release lands at once with no spring, a book does not give under a tap, and
   *  the view holds still. */
  setStill(still: boolean) {
    this.still = still;
    if (still) this.drift = { yaw: 0, pitch: 0 };
  }

  attach(scene: ShelfScene | null) {
    this.scene = scene;
    this.onDrawn(!!scene);
    if (!scene) return;
    scene.resize(this.stage.width, this.stage.height, this.pixelRatio, this.stage.centre, this.stage.zoom);
    scene.setTheme(this.theme.dark, this.theme.background);
    scene.setBooks(this.specs);
    // The scene keeps a cover from here on, and frees it with itself.
    for (const [key, cover] of this.covers) scene.setCover(key, cover.texture, cover.aspect);
    this.covers.clear();
    this.draw();
  }

  setStage(stage: ShelfStage, pixelRatio: number) {
    this.stage = stage;
    this.pixelRatio = pixelRatio;
    this.scene?.resize(stage.width, stage.height, pixelRatio, stage.centre, stage.zoom);
    this.draw();
  }

  /** How the shelf answers a swipe. Switched to a display row, the book in front comes out. */
  setMotion(motion: ShelfMotion) {
    if (motion === this.motion) return;
    this.motion = motion;
    this.shown = { index: Math.round(this.target), amount: 0 };
    this.settles = this.books.map(() => 0);
    this.settleVelocities = this.books.map(() => 0);
    this.kick();
    this.draw();
  }

  setTheme(dark: boolean, background: string) {
    this.theme = { dark, background };
    this.scene?.setTheme(dark, background);
    this.draw();
  }

  /**
   * The books, in the shelf's order. Until the reader has moved the shelf it opens on the middle
   * one, which is where the shelf stands what matters most — of every set, since the first is
   * whichever of the shelf's two halves answered first, and its middle is not the shelf's. After
   * that the book in front stays in front wherever a new order puts it — the one just read moves
   * to the middle while the reader is away in it, and coming back to a different book in front
   * would be coming back to the wrong shelf. A front book that has left the shelf gives its place
   * to the one that now stands there.
   */
  setBooks(specs: readonly ShelfBookSpec[]) {
    const front = this.specs[this.target]?.key;
    const shown = this.specs[this.shown.index]?.key;
    this.specs = specs;
    this.books = specs.map((s) => ({ width: s.width, height: s.height, depth: s.depth, binding: s.cover.binding, form: s.cover.form }));
    // A new order moves the books out from under the pointer: its next move finds the one there.
    this.hovered = -1;
    this.lifts = specs.map(() => 0);
    const last = Math.max(0, specs.length - 1);
    const now = specs.findIndex((s) => s.key === front);
    if (!this.touched) this.pos = this.target = shelfMiddle(specs.length);
    else if (now >= 0 && now !== this.target) {
      this.pos += now - this.target;
      this.target = now;
    }
    this.target = Math.min(this.target, last);
    this.pos = Math.min(this.pos, last);
    // The book on display stays out through a new order; one that has left the shelf gives way to
    // the book in front, which comes out. A shelf the reader has not moved opens with it out.
    this.row = displayRow(this.books);
    const shownNow = specs.findIndex((s) => s.key === shown);
    if (!this.touched) this.shown = { index: this.target, amount: 1 };
    else if (shownNow >= 0) this.shown = { index: shownNow, amount: this.shown.amount };
    else this.shown = { index: this.target, amount: 0 };
    this.settles = specs.map(() => 0);
    this.settleVelocities = specs.map(() => 0);
    if (this.motion === 'display' && this.shown.amount < 1) this.kick();
    this.scene?.setBooks(specs);
    this.announce(Math.round(this.pos), false);
    this.draw();
  }

  setCover(key: string, texture: THREE.Texture, aspect: number) {
    if (this.scene) this.scene.setCover(key, texture, aspect);
    else {
      this.covers.get(key)?.texture.dispose();
      this.covers.set(key, { texture, aspect });
    }
    this.draw();
  }

  grab() {
    this.touched = true;
    this.held = true;
    this.grabbedAt = this.pos;
    this.grabbedRow = rowAt(this.row, this.pos);
    this.velocity = 0;
    this.hover(-1);
    this.pressOut();
  }

  /** The book under the pointer, or -1 when it is over none or has left the stage. A spine under it
   *  comes a little way off the shelf; the book in front, already out, does not. Nothing lifts while
   *  the shelf is held: the books are running under a pointer that is dragging them. */
  hover(index: number) {
    if (this.held && index >= 0) return;
    if (index === this.hovered) return;
    this.hovered = index;
    if (this.still) {
      this.lifts = this.lifts.map((_, i) => (i === index && i !== this.target ? 1 : 0));
      this.draw();
      return;
    }
    this.kick();
  }

  /** The finger's travel since `grab`, in points: right is toward the shelf's start. Under
   *  `display` the row moves under it point for point; the others take `dragUnit` of it a book,
   *  which under `display-swipe` is the room each book has to come out and go back. */
  drag(dx: number) {
    const books = this.books.length;
    if (this.motion === 'display') this.pos = rubberBand(posAtRow(this.row, this.grabbedRow - dx / (this.stage.zoom ?? 1)), books);
    else this.pos = rubberBand(this.grabbedAt - dx / this.dragUnit(), books);
    this.kick();
  }

  release(velocityX: number) {
    if (!this.held) return;
    this.held = false;
    this.velocity = this.motion === 'display' ? -velocityX / (this.stage.zoom ?? 1) / rowSpacing(this.row, this.pos) : -velocityX / this.dragUnit();
    this.goTo(settleOn(this.pos, this.velocity, this.books.length));
  }

  goTo(index: number) {
    this.touched = true;
    this.target = Math.min(Math.max(0, index), Math.max(0, this.books.length - 1));
    if (this.still) {
      this.pos = this.target;
      this.velocity = 0;
    }
    this.kick();
  }

  /** A finger's travel for one book, as large as the books are drawn. */
  private dragUnit(): number {
    return SHELF.dragUnit * (this.stage.zoom ?? 1);
  }

  /** The book under a point of the stage, or -1. */
  bookAt(x: number, y: number): number {
    return this.scene?.pick(x, y) ?? -1;
  }

  /** Settles once the GPU has done what it has been handed so far (`ShelfScene.drawn`). */
  drawn(): Promise<unknown> | undefined {
    return this.scene?.drawn();
  }

  /** A finger is down on the front book: it gives under it. */
  pressIn() {
    if (!this.scene || this.still) return;
    this.pressing = true;
    this.onPressed = null;
    this.kick();
  }

  /**
   * The finger is up. With `then`, it was a tap: the book springs out past where it stood and
   * `then` is called at the furthest it comes — at once where there is nothing to wait for
   * (nothing drawn yet, Reduce Motion). Never sooner: what `then` starts, a page being pushed,
   * takes the thread these frames are drawn on, so the book stops wherever it is when that begins,
   * and the place to stop is at the end of its move. Without `then` the finger went elsewhere, and
   * the book only comes back.
   */
  pressOut(then?: () => void) {
    this.pressing = false;
    if (!this.scene || this.still) {
      this.press = this.pressVelocity = 0;
      this.onPressed = null;
      then?.();
      return;
    }
    if (!then) {
      this.onPressed = null;
      if (this.press || this.pressVelocity) this.kick();
      return;
    }
    // A tap is over before the spring has taken the book far: it takes the knock all the same.
    this.pressVelocity = Math.max(this.pressVelocity, PRESS_KNOCK);
    this.onPressed = then;
    this.releasedAt = -1;
    this.kick();
  }

  dispose() {
    this.frames.stop();
    this.moving = false;
    this.scene = null;
    for (const cover of this.covers.values()) cover.texture.dispose();
    this.covers.clear();
  }

  private kick() {
    if (this.moving) return;
    this.moving = true;
    this.frames.start();
  }

  /**
   * One frame, at `now` milliseconds on the frames' own clock, with the device tipped `tilt` (-1 to
   * 1 each way; level where there is nothing to read it).
   */
  step = (now: number, tiltX = 0, tiltY = 0) => {
    const dt = this.last ? Math.min(0.032, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    if (!this.still) this.drift = driftAt(now, { x: tiltX, y: tiltY });
    if (this.moving) {
      if (!this.held) {
        this.velocity += (-STIFFNESS * (this.pos - this.target) - DAMPING * this.velocity) * dt;
        this.pos += this.velocity * dt;
        if (Math.abs(this.pos - this.target) < 0.0008 && Math.abs(this.velocity) < 0.01) {
          this.pos = this.target;
          this.velocity = 0;
        }
      }
      const { stiffness, damping } = this.pressing ? PRESS_IN : PRESS_OUT;
      const to = this.pressing ? 1 : 0;
      this.pressVelocity += (-stiffness * (this.press - to) - damping * this.pressVelocity) * dt;
      this.press += this.pressVelocity * dt;
      if (Math.abs(this.press - to) < 0.003 && Math.abs(this.pressVelocity) < 0.05) {
        this.press = to;
        this.pressVelocity = 0;
      }
      const shown =
        this.motion === 'display'
          ? this.stepDisplay(dt)
          : this.motion === 'display-swipe'
            ? this.stepSettles(dt, displayScrubbed(this.pos, this.books.length))
            : true;
      let lifted = true;
      const ease = 1 - Math.exp(-HOVER_RATE * dt);
      const front = Math.round(this.target);
      for (let i = 0; i < this.lifts.length; i++) {
        const to = i === this.hovered && i !== front ? 1 : 0;
        const lift = this.lifts[i];
        if (lift === to) continue;
        const next = lift + (to - lift) * ease;
        this.lifts[i] = Math.abs(next - to) < 0.004 ? to : next;
        if (this.lifts[i] !== to) lifted = false;
      }
      // Under a finger the next frame is asked for by the finger's next move.
      const pressed = this.pressVelocity === 0 && this.press === (this.pressing ? 1 : 0);
      if (pressed && lifted && shown && (this.held || (this.pos === this.target && this.velocity === 0))) {
        this.moving = false;
        this.frames.stop();
      }
    }
    this.draw();
    // Out past where it stood and turning back, or back at rest, or long enough.
    if (this.releasedAt < 0) this.releasedAt = now;
    const out = (this.press <= 0 && this.pressVelocity >= 0) || now - this.releasedAt > PRESS_WAIT;
    if (this.onPressed && !this.pressing && out) {
      const tapped = this.onPressed;
      this.onPressed = null;
      tapped();
    }
  };

  /**
   * A display row's own frame: the book the shelf has landed on comes out, once the one before it
   * has gone back (the display is one book's at a time), and the two beside it settle into the
   * gap. Whether all of that is at rest.
   */
  private stepDisplay(dt: number): boolean {
    const n = this.books.length;
    if (!n) return true;
    const front = Math.min(Math.max(0, Math.round(this.pos)), n - 1);
    if (this.shown.index !== front && this.shown.amount === 0) this.shown.index = front;
    const landed = !this.held && this.target === front && Math.abs(this.pos - this.target) < DISPLAY.landing;
    const want = landed && this.shown.index === front ? 1 : 0;
    const { amount } = this.shown;
    this.shown.amount = this.still ? want : want > amount ? Math.min(want, amount + dt / DISPLAY.out) : Math.max(want, amount - dt / DISPLAY.back);
    // Back in on this frame: the next is handed the display now, or a shelf that came to rest as
    // the last went back would stop asking for frames with the next still on the shelf.
    if (this.shown.index !== front && this.shown.amount === 0) this.shown.index = front;
    const rest = this.shown.amount === (landed && this.shown.index === front ? 1 : 0);
    return this.stepSettles(dt, this.shown) && rest;
  }

  /** The books beside the one on display settling into its gap, or back upright. Whether they have. */
  private stepSettles(dt: number, shown: { index: number; amount: number }): boolean {
    let rest = true;
    const goals = displaySettles(this.books.length, this.pos, shown, this.motion === 'display');
    for (let i = 0; i < goals.length; i++) {
      const goal = goals[i];
      if (this.settles[i] === goal && this.settleVelocities[i] === 0) continue;
      if (this.still) {
        this.settles[i] = goal;
        this.settleVelocities[i] = 0;
        continue;
      }
      this.settleVelocities[i] += (-SETTLE.stiffness * (this.settles[i] - goal) - SETTLE.damping * this.settleVelocities[i]) * dt;
      this.settles[i] += this.settleVelocities[i] * dt;
      if (Math.abs(this.settles[i] - goal) < 0.002 && Math.abs(this.settleVelocities[i]) < 0.01) {
        this.settles[i] = goal;
        this.settleVelocities[i] = 0;
      } else rest = false;
    }
    return rest;
  }

  private draw() {
    if (!this.books.length || !this.stage.width) return;
    const display = this.motion !== 'carousel';
    // Played by the swipe itself under `display-swipe`, so worked out from where it is.
    const shown = this.motion === 'display-swipe' ? displayScrubbed(this.pos, this.books.length) : this.shown;
    const places = display ? placeDisplay(this.books, this.row, this.pos, shown, this.settles, this.motion === 'display') : placeShelf(this.books, this.pos);
    const front = Math.min(Math.max(0, Math.round(this.pos)), this.books.length - 1);
    for (let i = 0; i < places.length; i++) if (this.lifts[i]) places[i] = hoveredPlace(places[i], this.books[i], this.lifts[i]);
    if (this.press) places[front] = pressedPlace(places[front], this.press);
    if (this.scene) {
      this.scene.setView(this.drift.yaw, this.drift.pitch);
      this.scene.render(places, true);
    }
    // On a display row the callouts stand on the book on display, as far as it has come out, and
    // only after it has gone back on the one the swipe is over.
    const lead = display ? (shown.amount > 0 ? { index: shown.index, settled: shown.amount } : { index: front, settled: 0 }) : undefined;
    const callouts = shelfCallouts(this.books, places, this.pos, { ...this.stage, ...this.drift }, lead);
    this.onFrame(callouts);
    this.announce(callouts.front, this.touched);
  }

  private announce(index: number, byHand: boolean) {
    const key = this.specs[Math.min(Math.max(0, index), this.specs.length - 1)]?.key;
    if (key === this.front) return;
    this.front = key;
    if (key !== undefined) this.onFront(key, byHand);
  }
}
