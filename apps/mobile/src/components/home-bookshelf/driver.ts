import type * as THREE from 'three/webgpu';

import {
  SHELF,
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

/**
 * The shelf in motion, outside React: where along it the reader is, the drag and the spring that
 * settles it, and the one place a frame is drawn from. It holds what the scene is to show until
 * there is a scene to show it — the renderer starts later than the first books arrive — and its
 * frames are driven by `requestAnimationFrame` only while something is moving.
 */
export class ShelfDriver {
  private onFrame: (callouts: ShelfCallouts) => void = () => {};
  private onFront: (index: number) => void = () => {};
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
  private frame = 0;
  private last = 0;
  private front = -1;

  get focused(): number {
    return this.target;
  }

  /** `onFrame` is given each frame's callouts, for the views drawn over the stage; `onFront` the
   *  book in front when it changes; `onDrawn` whether there are books on screen for the callouts to
   *  stand on, which there are not until the renderer has started. */
  listen(to: { onFrame: (callouts: ShelfCallouts) => void; onFront: (index: number) => void; onDrawn: (drawn: boolean) => void }) {
    this.onFrame = to.onFrame;
    this.onFront = to.onFront;
    this.onDrawn = to.onDrawn;
    this.front = -1;
    this.draw();
  }

  /** Reduce Motion: a release lands at once, with no spring. */
  setStill(still: boolean) {
    this.still = still;
  }

  attach(scene: ShelfScene | null) {
    this.scene = scene;
    this.onDrawn(!!scene);
    if (!scene) return;
    scene.resize(this.stage.width, this.stage.height, this.pixelRatio);
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
    this.scene?.resize(stage.width, stage.height, pixelRatio);
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
    this.held = true;
    this.grabbedAt = this.pos;
    this.velocity = 0;
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

  dispose() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.scene = null;
    for (const cover of this.covers.values()) cover.texture.dispose();
    this.covers.clear();
  }

  private kick() {
    if (this.frame) return;
    this.last = 0;
    this.frame = requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    this.frame = 0;
    const dt = this.last ? Math.min(0.032, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    if (!this.held) {
      this.velocity += (-STIFFNESS * (this.pos - this.target) - DAMPING * this.velocity) * dt;
      this.pos += this.velocity * dt;
      if (Math.abs(this.pos - this.target) < 0.0008 && Math.abs(this.velocity) < 0.01) {
        this.pos = this.target;
        this.velocity = 0;
      }
    }
    this.draw();
    if (!this.held && (this.pos !== this.target || this.velocity !== 0)) this.frame = requestAnimationFrame(this.tick);
  };

  private draw() {
    if (!this.books.length || !this.stage.width) return;
    const places = placeShelf(this.books, this.pos);
    this.scene?.render(places, true);
    const callouts = shelfCallouts(this.books, places, this.pos, this.stage);
    this.onFrame(callouts);
    if (callouts.front !== this.front) {
      this.front = callouts.front;
      this.onFront(callouts.front);
    }
  }
}
