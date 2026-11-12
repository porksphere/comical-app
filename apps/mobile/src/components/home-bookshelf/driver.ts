import {
  SHELF,
  driftAt,
  placeShelf,
  pressedPlace,
  rubberBand,
  settleOn,
  shelfMiddle,
  shelfCallouts,
  type ShelfBook,
  type ShelfCallouts,
  type ShelfStage,
} from '@/lib/bookshelf';

import type { ShelfBookSpec, ShelfPicture, ShelfRenderer } from './spec';

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

  private scene: ShelfRenderer | null = null;
  private specs: readonly ShelfBookSpec[] = [];
  private books: readonly ShelfBook[] = [];
  private covers = new Map<string, { picture: ShelfPicture; aspect: number }>();
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
  private front = -1;
  /** How far the front book is pressed into the shelf (below 0 it has sprung out past rest), how
   *  fast, whether a finger is on it, and what its tap opens once it has come back out. */
  private press = 0;
  private pressVelocity = 0;
  private pressing = false;
  private onPressed: (() => void) | null = null;
  private releasedAt = 0;
  private drift = { yaw: 0, pitch: 0 };

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
    this.front = -1;
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

  attach(scene: ShelfRenderer | null) {
    this.scene = scene;
    this.onDrawn(!!scene);
    if (!scene) return;
    scene.resize(this.stage.width, this.stage.height, this.pixelRatio, this.stage.centre);
    scene.setTheme(this.theme.dark, this.theme.background);
    scene.setBooks(this.specs);
    // The scene keeps a cover from here on, and frees it with itself.
    for (const [key, cover] of this.covers) scene.setCover(key, cover.picture, cover.aspect);
    this.covers.clear();
    this.draw();
  }

  setStage(stage: ShelfStage, pixelRatio: number) {
    this.stage = stage;
    this.pixelRatio = pixelRatio;
    this.scene?.resize(stage.width, stage.height, pixelRatio, stage.centre);
    this.draw();
  }

  setTheme(dark: boolean, background: string) {
    this.theme = { dark, background };
    this.scene?.setTheme(dark, background);
    this.draw();
  }

  /**
   * The books, in the shelf's order. The first set opens on the middle one, which is where the
   * shelf stands what matters most. After that the book in front stays in front wherever a new
   * order puts it — the one just read moves to the middle while the reader is away in it, and
   * coming back to a different book in front would be coming back to the wrong shelf.
   */
  setBooks(specs: readonly ShelfBookSpec[]) {
    const had = this.specs.length;
    const front = this.specs[this.target]?.key;
    this.specs = specs;
    this.books = specs.map((s) => ({ width: s.width, height: s.height, depth: s.depth, binding: s.cover.binding }));
    const last = Math.max(0, specs.length - 1);
    if (!had) this.pos = this.target = shelfMiddle(specs.length);
    const now = specs.findIndex((s) => s.key === front);
    if (now >= 0 && now !== this.target) {
      this.pos += now - this.target;
      this.target = now;
      this.front = now;
    }
    this.target = Math.min(this.target, last);
    this.pos = Math.min(this.pos, last);
    this.scene?.setBooks(specs);
    this.draw();
  }

  setCover(key: string, picture: ShelfPicture, aspect: number) {
    if (this.scene) this.scene.setCover(key, picture, aspect);
    else {
      this.covers.get(key)?.picture.dispose();
      this.covers.set(key, { picture, aspect });
    }
    this.draw();
  }

  grab() {
    this.touched = true;
    this.held = true;
    this.grabbedAt = this.pos;
    this.velocity = 0;
    this.pressOut();
  }

  /** The finger's travel since `grab`, in points: right is toward the shelf's start. */
  drag(dx: number) {
    this.pos = rubberBand(this.grabbedAt - dx / SHELF.dragUnit, this.books.length);
    this.kick();
  }

  release(velocityX: number) {
    if (!this.held) return;
    this.held = false;
    this.velocity = -velocityX / SHELF.dragUnit;
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

  /** The book under a point of the stage, or -1. */
  bookAt(x: number, y: number): number {
    return this.scene?.pick(x, y) ?? -1;
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
    for (const cover of this.covers.values()) cover.picture.dispose();
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
      // Under a finger the next frame is asked for by the finger's next move.
      const pressed = this.pressVelocity === 0 && this.press === (this.pressing ? 1 : 0);
      if (pressed && (this.held || (this.pos === this.target && this.velocity === 0))) {
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

  private draw() {
    if (!this.books.length || !this.stage.width) return;
    const places = placeShelf(this.books, this.pos);
    const front = Math.min(Math.max(0, Math.round(this.pos)), this.books.length - 1);
    if (this.press) places[front] = pressedPlace(places[front], this.press);
    if (this.scene) {
      this.scene.setView(this.drift.yaw, this.drift.pitch);
      this.scene.render(places, true);
    }
    const callouts = shelfCallouts(this.books, places, this.pos, { ...this.stage, ...this.drift });
    this.onFrame(callouts);
    if (callouts.front !== this.front) {
      this.front = callouts.front;
      const key = this.specs[callouts.front]?.key;
      if (key !== undefined) this.onFront(key, this.touched);
    }
  }
}
