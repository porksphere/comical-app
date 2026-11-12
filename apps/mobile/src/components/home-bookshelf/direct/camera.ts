/**
 * The shelf's camera as matrices, for the renderer that has no engine to keep them: the same eye
 * `projectToStage` (lib/bookshelf) projects through, which `camera.test.ts` holds it to. Pure
 * arithmetic, so it can be tested where no GPU is.
 *
 * A matrix is sixteen numbers by columns, as a shader takes them. Clip space is WebGPU's: `z` runs
 * 0 at the near plane to 1 at the far one.
 */
import { SHELF, type ShelfBook, type ShelfPlace } from '@/lib/bookshelf';

export type Mat4 = Float32Array;
export type Vec3 = readonly [number, number, number];

const rad = (degrees: number) => (degrees * Math.PI) / 180;

const NEAR = 20;
const FAR = 6000;

// prettier-ignore
const matrix = (...rows: number[]): Mat4 => new Float32Array([
  rows[0], rows[4], rows[8], rows[12],
  rows[1], rows[5], rows[9], rows[13],
  rows[2], rows[6], rows[10], rows[14],
  rows[3], rows[7], rows[11], rows[15],
]);

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[column * 4 + k];
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

// prettier-ignore
const translation = (x: number, y: number, z: number) => matrix(
  1, 0, 0, x,
  0, 1, 0, y,
  0, 0, 1, z,
  0, 0, 0, 1,
);

// prettier-ignore
const aboutX = (angle: number) => matrix(
  1, 0, 0, 0,
  0, Math.cos(angle), -Math.sin(angle), 0,
  0, Math.sin(angle), Math.cos(angle), 0,
  0, 0, 0, 1,
);

// prettier-ignore
const aboutY = (angle: number) => matrix(
  Math.cos(angle), 0, Math.sin(angle), 0,
  0, 1, 0, 0,
  -Math.sin(angle), 0, Math.cos(angle), 0,
  0, 0, 0, 1,
);

/** A point through a matrix, divided through by its `w`. */
export function through(m: Mat4, [x, y, z]: Vec3): Vec3 {
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w];
}

export type StageView = { width: number; height: number; centre: number; yaw: number; pitch: number };

/** Where the eye stands, in the world: `lens` back from the shelf, level with 44% down the stage. */
export const eyeOf = (stage: StageView): Vec3 => [0, 0.56 * stage.height - SHELF.floor, SHELF.lens];

/** The eye's window on the world at its near plane: the stage, square on to `centre`. */
function windowOf(stage: StageView) {
  const k = NEAR / SHELF.lens;
  return { left: -stage.centre * k, right: (stage.width - stage.centre) * k, top: 0.44 * stage.height * k, bottom: -0.56 * stage.height * k };
}

/** The world to clip space. */
export function viewProjection(stage: StageView): Mat4 {
  const { left, right, top, bottom } = windowOf(stage);
  const [, eyeY, eyeZ] = eyeOf(stage);
  // prettier-ignore
  const projection = matrix(
    (2 * NEAR) / (right - left), 0, (right + left) / (right - left), 0,
    0, (2 * NEAR) / (top - bottom), (top + bottom) / (top - bottom), 0,
    0, 0, FAR / (NEAR - FAR), (NEAR * FAR) / (NEAR - FAR),
    0, 0, -1, 0,
  );
  return multiply(projection, translation(0, -eyeY, -eyeZ));
}

/** The shelf's space to the world: tipped `look` degrees and turned by the view's drift, about the
 *  stage's middle. */
export function shelfToWorld(stage: StageView): Mat4 {
  const middle = stage.height / 2 - SHELF.floor;
  return [translation(0, middle, 0), aboutX(rad(SHELF.look + stage.pitch)), aboutY(rad(stage.yaw)), translation(0, -middle, 0)].reduce(multiply);
}

/** `shelfToWorld`, written into `out` from `at` on with nothing made on the way: this one changes
 *  with every frame of the view's drift, on the thread a frame's garbage is collected on. */
export function writeShelfToWorld(out: Float32Array, at: number, stage: StageView) {
  const middle = stage.height / 2 - SHELF.floor;
  const tip = rad(SHELF.look + stage.pitch);
  const turn = rad(stage.yaw);
  const ca = Math.cos(tip);
  const sa = Math.sin(tip);
  const cb = Math.cos(turn);
  const sb = Math.sin(turn);
  out.fill(0, at, at + 16);
  out[at] = cb;
  out[at + 1] = sa * sb;
  out[at + 2] = -ca * sb;
  out[at + 5] = ca;
  out[at + 6] = sa;
  out[at + 8] = sb;
  out[at + 9] = -sa * cb;
  out[at + 10] = ca * cb;
  out[at + 13] = middle * (1 - ca);
  out[at + 14] = -middle * sa;
  out[at + 15] = 1;
}

/** The world back to the shelf's space. */
export function worldToShelf(stage: StageView): Mat4 {
  const middle = stage.height / 2 - SHELF.floor;
  return [translation(0, middle, 0), aboutY(rad(-stage.yaw)), aboutX(rad(-SHELF.look - stage.pitch)), translation(0, -middle, 0)].reduce(multiply);
}

/** Where the key light stands and what it looks at, in the world. */
export const SUN = { from: [-250, 620, 560], at: [0, 100, 0], reach: 380, near: 100, far: 2400 } as const;

const minus = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: Vec3): Vec3 => {
  const length = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
};

/** The direction toward the key light. */
export const sunward = unit(minus(SUN.from, SUN.at));

/**
 * The shelf's space to the key light's clip space, which the shadow is cast and read in. The light
 * stands where it does over a shelf that is not drifting, and goes with the shelf as it drifts: a
 * shadow cast again for every degree of drift crawled along its edge, a texel at a time, and one
 * that goes with the shelf is cast only when a book has moved.
 */
export function sunOverShelf(stage: StageView): Mat4 {
  return multiply(sunProjection(), shelfToWorld({ ...stage, yaw: 0, pitch: 0 }));
}

/** The world to the key light's clip space. */
export function sunProjection(): Mat4 {
  const back = sunward;
  const right = unit(cross([0, 1, 0], back));
  const up = cross(back, right);
  // prettier-ignore
  const view = matrix(
    right[0], right[1], right[2], -dot(right, SUN.from),
    up[0], up[1], up[2], -dot(up, SUN.from),
    back[0], back[1], back[2], -dot(back, SUN.from),
    0, 0, 0, 1,
  );
  // prettier-ignore
  const projection = matrix(
    1 / SUN.reach, 0, 0, 0,
    0, 1 / SUN.reach, 0, 0,
    0, 0, 1 / (SUN.near - SUN.far), SUN.near / (SUN.near - SUN.far),
    0, 0, 0, 1,
  );
  return multiply(projection, view);
}

/** How far a hard cover's rounded back stands out past its boards. */
export const spineBulge = (depth: number) => Math.min(6, Math.max(2, depth * 0.24));

/**
 * The book under a point of the stage, or -1: the nearest whose box the eye's line through that
 * point passes through. `hard` says which books have a rounded back, which stands out past the box.
 */
export function pickBook(stage: StageView, books: readonly (ShelfBook & { hard: boolean })[], places: readonly ShelfPlace[], x: number, y: number): number {
  const { left, right, top, bottom } = windowOf(stage);
  const eye = eyeOf(stage);
  const toward: Vec3 = [left + (x / stage.width) * (right - left), top - (y / stage.height) * (top - bottom), -NEAR];
  const back = worldToShelf(stage);
  const from = through(back, eye);
  const along = minus(through(back, [eye[0] + toward[0], eye[1] + toward[1], eye[2] + toward[2]]), from);
  let found = -1;
  let nearest = Infinity;
  books.forEach((book, index) => {
    const place = places[index];
    if (!place) return;
    // Into the book's own space: its foot's middle at the origin, its cover toward +z.
    const c = Math.cos(rad(place.yaw));
    const s = Math.sin(rad(place.yaw));
    const local = ([px, py, pz]: Vec3): Vec3 => [px * c - pz * s, py, px * s + pz * c];
    const origin = local([from[0] - place.x, from[1], from[2] - place.z]);
    const ray = local(along);
    const bulge = book.hard ? spineBulge(book.depth) : 0;
    const low: Vec3 = [-book.width / 2 - (book.binding === 'left' ? bulge : 0), 0, -book.depth / 2];
    const high: Vec3 = [book.width / 2 + (book.binding === 'right' ? bulge : 0), book.height, book.depth / 2];
    let enter = 0;
    let leave = Infinity;
    for (let axis = 0; axis < 3; axis++) {
      if (Math.abs(ray[axis]) < 1e-9) {
        if (origin[axis] < low[axis] || origin[axis] > high[axis]) return;
        continue;
      }
      const a = (low[axis] - origin[axis]) / ray[axis];
      const b = (high[axis] - origin[axis]) / ray[axis];
      enter = Math.max(enter, Math.min(a, b));
      leave = Math.min(leave, Math.max(a, b));
    }
    if (enter <= leave && enter < nearest) {
      nearest = enter;
      found = index;
    }
  });
  return found;
}
