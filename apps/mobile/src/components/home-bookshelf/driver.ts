import type * as THREE from 'three/webgpu';

import {
  SHELF,
  driftAt,
  openedPlace,
  placeShelf,
  rubberBand,
  settleOn,
  shelfCallouts,
  type ShelfBook,
  type ShelfCallouts,
  type ShelfStage,
} from '@/lib/bookshelf';

import type { ShelfBookSpec, ShelfScene } from './scene';

const STIFFNESS = 190;
const DAMPING = 25;
/** Per second: how fast a cover swings toward open or shut. Most of the way in a third of one. */
const SWING = 9;

/**
 * The shelf in motion, outside React: where along it the reader is, the drag and the spring that
 * settles it, the cover that opens, the view's drift, and the one place a frame is drawn from. It
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
  private onFront: (index: number, byHand: boolean) => void = () => {};
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
  private front = -1;
  /** How far the front book's cover has swung, where it is headed, and who to tell on arrival. */
  private open = 0;
  private openTo = 0;
  private onOpened: (() => void) | null = null;
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
    onFront: (index: number, byHand: boolean) => void;
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

  /** Reduce Motion: a release lands at once with no spring, a cover does not swing, and the view
   *  holds still. */
  setStill(still: boolean) {
    this.still = still;
    if (still) this.drift = { yaw: 0, pitch: 0 };
  }

  attach(scene: ShelfScene | null) {
    this.scene = scene;
    this.onDrawn(!!scene);
    if (!scene) return;
    scene.resize(this.stage.width, this.stage.height, this.pixelRatio, this.stage.centre);
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
    this.scene?.resize(stage.width, stage.height, pixelRatio, stage.centre);
    this.draw();
  }

  setTheme(dark: boolean, background: string) {
    this.theme = { dark, background };
    this.scene?.setTheme(dark, background);
    this.draw();
  }

  setBooks(specs: readonly ShelfBookSpec[]) {
    this.specs = specs;
    this.books = specs.map((s) => ({ width: s.width, height: s.height, depth: s.depth, binding: s.cover.binding }));
    const last = Math.max(0, specs.length - 1);
    this.target = Math.min(this.target, last);
    this.pos = Math.min(this.pos, last);
    this.scene?.setBooks(specs);
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
    this.velocity = 0;
    this.shut();
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
    if (this.target !== Math.round(this.pos)) this.shut();
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

  /**
   * Swings the front book's cover open and calls `then` when it has — at once where there is no
   * swing to wait for: nothing drawn yet, Reduce Motion, or a form with no cover to open (the
   * scene swings what it can; a slab or a set of prints simply stands).
   */
  openFront(then: () => void) {
    if (!this.scene || this.still) {
      then();
      return;
    }
    this.openTo = 1;
    this.onOpened = then;
    this.kick();
  }

  /** Swings it shut again: the reader is back. */
  shut() {
    this.onOpened = null;
    if (!this.open && !this.openTo) return;
    this.openTo = 0;
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
      this.open += (this.openTo - this.open) * Math.min(1, dt * SWING);
      if (Math.abs(this.openTo - this.open) < 0.004) this.open = this.openTo;
      // Told while the cover still has a little way to swing: the page that opens covers the rest.
      if (this.open >= 0.9 && this.onOpened) {
        const arrived = this.onOpened;
        this.onOpened = null;
        arrived();
      }
      // Under a finger the next frame is asked for by the finger's next move.
      if (this.open === this.openTo && (this.held || (this.pos === this.target && this.velocity === 0))) {
        this.moving = false;
        this.frames.stop();
      }
    }
    this.draw();
  };

  private draw() {
    if (!this.books.length || !this.stage.width) return;
    const places = placeShelf(this.books, this.pos);
    const front = Math.min(Math.max(0, Math.round(this.pos)), this.books.length - 1);
    if (this.open) places[front] = openedPlace(places[front], this.books[front], this.open);
    if (this.scene) {
      this.scene.setView(this.drift.yaw, this.drift.pitch);
      this.scene.setOpen(front, this.open);
      this.scene.render(places, true);
    }
    const callouts = shelfCallouts(this.books, places, this.pos, { ...this.stage, ...this.drift }, this.open);
    this.onFrame(callouts);
    if (callouts.front !== this.front) {
      this.front = callouts.front;
      this.onFront(callouts.front, this.touched);
    }
  }
}
