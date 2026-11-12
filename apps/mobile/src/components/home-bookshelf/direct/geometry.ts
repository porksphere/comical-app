/**
 * The shelf's shapes as bare triangles, for the renderer that has no engine to build them: a book
 * of each form, and the plank they stand on. Each is the shape `scene.ts` builds with three, to the
 * same measurements. Pure, so it can be tested where no GPU is.
 *
 * A book is in its own space: its foot's middle at the origin, `y` up, its cover toward `+z`. A
 * vertex is nine numbers — where it is, which way its face looks, where on a picture it falls, and
 * what it is made of — and a face is wound counter-clockwise seen from outside.
 */
import { PRINT } from '@/lib/book-cover';

import type { ShelfBookSpec } from '../spec';
import { spineBulge } from './camera';

export const VERTEX_FLOATS = 9;

/** What a face is made of, which the shader lights and tones by. */
export const MATERIAL = {
  board: 0,
  cover: 1,
  /** A page block's cut edges, and its first and last page. */
  edges: 2,
  page: 3,
  spine: 4,
  /** A print's paper, and the picture on the print behind. */
  print: 5,
  behind: 6,
  staple: 7,
  plankTop: 8,
  plankFront: 9,
  rim: 10,
} as const;

/** How a set's two prints stand: each one's lean in degrees, and how far the one behind sits
 *  toward the binding's side, of the width (`PRINT_LEAN` in `scene.ts`). */
const PRINT_LEAN = { front: -3, behind: 8.5, aside: 0.07 } as const;

type P3 = readonly [number, number, number];
type P2 = readonly [number, number];
type Place = (point: P3) => P3;

const rad = (degrees: number) => (degrees * Math.PI) / 180;
const sub = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: P3, b: P3): P3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: P3): P3 => {
  const length = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
};

/** A run of a book's vertices: what one draw takes. */
export type Run = { first: number; count: number };

/** Which shader a surface is drawn by: one with no picture, a cover's, or a spine's. */
const partOf = (material: number) => (material === MATERIAL.cover || material === MATERIAL.behind ? 'cover' : material === MATERIAL.spine ? 'spine' : 'plain');

/**
 * Triangles gathered by what draws them and whether they cast the book's shadow, and handed over in
 * an order that leaves each of those one run: what has no picture, the cover, the spine — and, across
 * the join of the first two, what casts.
 */
class Triangles {
  /** Whether what is added next casts the book's shadow. */
  casts = false;
  private readonly held = { plain: [] as number[], plainCasting: [] as number[], coverCasting: [] as number[], cover: [] as number[], spine: [] as number[] };

  private vertex(at: P3, normal: P3, uv: P2, material: number) {
    const part = partOf(material);
    const into = part === 'spine' ? this.held.spine : part === 'cover' ? (this.casts ? this.held.coverCasting : this.held.cover) : this.casts ? this.held.plainCasting : this.held.plain;
    into.push(at[0], at[1], at[2], normal[0], normal[1], normal[2], uv[0], uv[1], material);
  }

  finish() {
    const { plain, plainCasting, coverCasting, cover, spine } = this.held;
    const of = (floats: readonly number[]) => floats.length / VERTEX_FLOATS;
    return {
      vertices: new Float32Array([...plain, ...plainCasting, ...coverCasting, ...cover, ...spine]),
      plain: { first: 0, count: of(plain) + of(plainCasting) },
      casting: { first: of(plain), count: of(plainCasting) + of(coverCasting) },
      cover: { first: of(plain) + of(plainCasting), count: of(coverCasting) + of(cover) },
      spine: { first: of(plain) + of(plainCasting) + of(coverCasting) + of(cover), count: of(spine) },
    };
  }

  /** A flat triangle, or one with a normal of its own at each corner. */
  triangle(a: P3, b: P3, c: P3, material: number, uvs: readonly [P2, P2, P2] = [[0, 0], [0, 0], [0, 0]], normals?: readonly [P3, P3, P3]) {
    const flat = unit(cross(sub(b, a), sub(c, a)));
    this.vertex(a, normals?.[0] ?? flat, uvs[0], material);
    this.vertex(b, normals?.[1] ?? flat, uvs[1], material);
    this.vertex(c, normals?.[2] ?? flat, uvs[2], material);
  }

  /** Four corners in order round the face; the picture's corners go round with them. */
  quad(a: P3, b: P3, c: P3, d: P3, material: number, uvs: readonly [P2, P2, P2, P2] = [[0, 0], [1, 0], [1, 1], [0, 1]], normals?: readonly [P3, P3, P3, P3]) {
    this.triangle(a, b, c, material, [uvs[0], uvs[1], uvs[2]], normals && [normals[0], normals[1], normals[2]]);
    this.triangle(a, c, d, material, [uvs[0], uvs[2], uvs[3]], normals && [normals[0], normals[2], normals[3]]);
  }

  /** A box about `centre`. `ends` is what its front and back (`±z`) are made of, where that is not
   *  what the four sides round them are. */
  box(centre: P3, [w, h, d]: P3, material: number, place: Place = (p) => p, ends = material) {
    const corner = (i: number, j: number, k: number) => place([centre[0] + (i * w) / 2, centre[1] + (j * h) / 2, centre[2] + (k * d) / 2]);
    this.quad(corner(-1, -1, 1), corner(1, -1, 1), corner(1, 1, 1), corner(-1, 1, 1), ends);
    this.quad(corner(1, -1, -1), corner(-1, -1, -1), corner(-1, 1, -1), corner(1, 1, -1), ends);
    this.quad(corner(1, -1, 1), corner(1, -1, -1), corner(1, 1, -1), corner(1, 1, 1), material);
    this.quad(corner(-1, -1, -1), corner(-1, -1, 1), corner(-1, 1, 1), corner(-1, 1, -1), material);
    this.quad(corner(-1, 1, 1), corner(1, 1, 1), corner(1, 1, -1), corner(-1, 1, -1), material);
    this.quad(corner(-1, -1, -1), corner(1, -1, -1), corner(1, -1, 1), corner(-1, -1, 1), material);
  }

  /** A flat outline filled, facing `+z` at `z` (or `-z`, wound the other way). An outline here is
   *  convex, so it is a fan from its first corner. */
  cap(outline: readonly P2[], z: number, material: number, uv: (point: P2) => P2, place: Place = (p) => p, facing: 1 | -1 = 1) {
    for (let n = 1; n < outline.length - 1; n++) {
      const [a, b, c] = facing > 0 ? [outline[0], outline[n], outline[n + 1]] : [outline[0], outline[n + 1], outline[n]];
      this.triangle(place([a[0], a[1], z]), place([b[0], b[1], z]), place([c[0], c[1], z]), material, [uv(a), uv(b), uv(c)]);
    }
  }

  /**
   * An outline given thickness from `back` to `front`, its rim rounded over `bevel` in `steps`.
   * `inset` takes the rounding out of the outline's own size (a cover's rolled edge); otherwise it
   * is added round it (a slab's bevelled rim), as three's extrusion does either way.
   */
  slab(
    outline: readonly P2[],
    { back, front, bevel, steps, inset, faces, rim, uv, place = (p) => p }: { back: number; front: number; bevel: number; steps: number; inset: boolean; faces: number; rim: number; uv: (point: P2) => P2; place?: Place },
  ) {
    const rings: { grown: number; z: number }[] = [];
    for (let n = 0; n <= steps; n++) {
      const turn = (n / steps) * (Math.PI / 2);
      rings.push({ grown: bevel * Math.sin(turn) - (inset ? bevel : 0), z: back + bevel * (1 - Math.cos(turn)) });
    }
    for (let n = steps; n >= 0; n--) {
      const turn = (n / steps) * (Math.PI / 2);
      rings.push({ grown: bevel * Math.sin(turn) - (inset ? bevel : 0), z: front - bevel * (1 - Math.cos(turn)) });
    }
    const loops = rings.map(({ grown }) => grow(outline, grown));
    this.cap(loops[0], rings[0].z, faces, uv, place, -1);
    this.cap(loops[loops.length - 1], rings[rings.length - 1].z, faces, uv, place, 1);
    for (let ring = 0; ring < rings.length - 1; ring++) {
      const lower = loops[ring];
      const upper = loops[ring + 1];
      for (let n = 0; n < outline.length; n++) {
        const next = (n + 1) % outline.length;
        this.quad(
          place([lower[n][0], lower[n][1], rings[ring].z]),
          place([lower[next][0], lower[next][1], rings[ring].z]),
          place([upper[next][0], upper[next][1], rings[ring + 1].z]),
          place([upper[n][0], upper[n][1], rings[ring + 1].z]),
          rim,
        );
      }
    }
  }
}

/** An outline wound counter-clockwise, with no corner given twice. */
function outlineOf(points: readonly P2[]): P2[] {
  const kept = points.filter((p, n) => {
    const before = points[(n + points.length - 1) % points.length];
    return Math.hypot(p[0] - before[0], p[1] - before[1]) > 1e-6;
  });
  let area = 0;
  kept.forEach((p, n) => {
    const next = kept[(n + 1) % kept.length];
    area += p[0] * next[1] - next[0] * p[1];
  });
  return area < 0 ? kept.reverse() : kept;
}

/** An outline with each side moved `by` outward (inward below zero), its corners mitred. */
function grow(outline: readonly P2[], by: number): P2[] {
  if (!by) return [...outline];
  return outline.map((p, n) => {
    const before = outline[(n + outline.length - 1) % outline.length];
    const after = outline[(n + 1) % outline.length];
    const side = (from: P2, to: P2): P2 => {
      const length = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
      return [(to[1] - from[1]) / length, -(to[0] - from[0]) / length];
    };
    const a = side(before, p);
    const b = side(p, after);
    const mitre = Math.max(0.25, 1 + a[0] * b[0] + a[1] * b[1]);
    return [p[0] + ((a[0] + b[0]) / mitre) * by, p[1] + ((a[1] + b[1]) / mitre) * by];
  });
}

/** A corner rounded from `from` to `to` about `corner`, in six steps as three samples a curve. */
function rounded(from: P2, corner: P2, to: P2): P2[] {
  const points: P2[] = [];
  for (let n = 0; n <= 6; n++) {
    const t = n / 6;
    points.push([(1 - t) * (1 - t) * from[0] + 2 * (1 - t) * t * corner[0] + t * t * to[0], (1 - t) * (1 - t) * from[1] + 2 * (1 - t) * t * corner[1] + t * t * to[1]]);
  }
  return points;
}

export type BookGeometry = {
  vertices: Float32Array;
  /** The runs of it each shader draws, and the run that casts the book's shadow. */
  plain: Run;
  cover: Run;
  spine: Run;
  casting: Run;
  /** A hard cover's rounded back, for its lettering: its length round, in points. */
  back?: { width: number; height: number };
};

/** A book's triangles (`scene.ts`'s `build`, shape for shape). */
export function buildBook(spec: ShelfBookSpec): BookGeometry {
  const { width: w, height: h, depth: d } = spec;
  const { form, binding } = spec.cover;
  const side = binding === 'left' ? -1 : 1;
  const hinge = (side * w) / 2;
  const half = d / 2;
  const out = new Triangles();
  let back: BookGeometry['back'];

  if (form === 'scroll') {
    // Nothing bound: a slab with rounded corners and a bevelled rim, its picture on both faces.
    const r = 5;
    const bevel = Math.min(0.9, d * 0.3);
    out.casts = true;
    const outline = outlineOf([
      ...rounded([w / 2 - r, -h / 2], [w / 2, -h / 2], [w / 2, -h / 2 + r]),
      ...rounded([w / 2, h / 2 - r], [w / 2, h / 2], [w / 2 - r, h / 2]),
      ...rounded([-w / 2 + r, h / 2], [-w / 2, h / 2], [-w / 2, h / 2 - r]),
      ...rounded([-w / 2, -h / 2 + r], [-w / 2, -h / 2], [-w / 2 + r, -h / 2]),
    ]);
    out.slab(outline, {
      back: -half,
      front: -half + Math.max(0.2, d - 2 * bevel) + 2 * bevel,
      bevel,
      steps: 2,
      inset: false,
      faces: MATERIAL.cover,
      rim: MATERIAL.board,
      uv: ([x, y]) => [x / w + 0.5, y / h + 0.5],
      place: ([x, y, z]) => [x, y + h / 2, z],
    });
  } else if (form === 'sheets') {
    // A print in a white paper border with another tipped behind it: two cards with the book's
    // depth between them, each leaning its own way on a corner.
    const border = PRINT.border * w;
    const card = 0.9;
    const print = (z: number, lean: number, along: number): Place => {
      const turn = rad(lean);
      const c = Math.cos(turn);
      const s = Math.sin(turn);
      // Turned about its own middle and stood on whichever corner is then lowest.
      const up = (h / 2) * c + (w / 2) * Math.abs(s);
      return ([x, y, dz]) => [along + x * c - y * s, up + x * s + y * c, z + dz];
    };
    const prints = [
      { z: half - card / 2, picture: MATERIAL.cover, lean: -side * PRINT_LEAN.front, along: 0 },
      { z: -half + card / 2, picture: MATERIAL.behind, lean: -side * PRINT_LEAN.behind, along: side * w * PRINT_LEAN.aside },
    ].map((p) => ({ ...p, place: print(p.z, p.lean, p.along) }));
    out.casts = true;
    for (const { place } of prints) out.box([0, 0, 0], [w, h, card], MATERIAL.print, place);
    out.casts = false;
    for (const { place, picture } of prints) {
      const x = w / 2 - border;
      const y = h / 2 - border;
      const z = card / 2 + 0.05;
      out.quad(place([-x, -y, z]), place([x, -y, z]), place([x, y, z]), place([-x, y, z]), picture);
    }
  } else {
    const hard = form === 'volume';
    const thick = hard ? 1.6 : 0.5;
    const overhang = hard ? 2.4 : 0;
    // The page block, set back from the boards on three sides. It alone casts the book's shadow.
    const blockDepth = Math.max(0.3, d - 2 * thick - 0.3);
    out.casts = true;
    out.box([(side * overhang) / 2, h / 2, 0], [w - overhang, h - 2 * overhang, blockDepth], MATERIAL.edges, undefined, MATERIAL.page);
    out.casts = false;

    out.box([0, h / 2, -half + thick / 2], [w, h, thick], MATERIAL.board);
    // The front board, cut to a cover's own outline — its two free corners rounded, the bound ones
    // square — with its edge rolled over, and its picture a sheet of its own just proud of it.
    const toward = -side;
    const corner = hard ? 3 : 2;
    const roll = hard ? 0.5 : 0.2;
    const outline = outlineOf([
      [0, 0],
      ...rounded([toward * (w - corner), 0], [toward * w, 0], [toward * w, corner]),
      ...rounded([toward * w, h - corner], [toward * w, h], [toward * (w - corner), h]),
      [0, h],
    ]);
    const stood: Place = ([x, y, z]) => [x + hinge, y, z];
    out.slab(outline, { back: half - thick, front: half, bevel: roll, steps: 3, inset: true, faces: MATERIAL.board, rim: MATERIAL.board, uv: () => [0, 0], place: stood });
    // The picture's own corners, from its left edge and its foot, whichever side it is bound on.
    out.cap(
      outline.map(([x, y]): P2 => [(x * (w - roll)) / w, (y * (h - 2 * roll)) / h + roll]),
      half + 0.05,
      MATERIAL.cover,
      ([x, y]) => [toward > 0 ? x / (w - roll) : x / (w - roll) + 1, (y - roll) / (h - 2 * roll)],
      stood,
    );

    if (hard) {
      // A rounded back: half an ellipse from board to board, lettered down its length.
      const bulge = spineBulge(d);
      const segments = 14;
      const at = (j: number) => {
        const f = -Math.PI / 2 + (Math.PI * j) / segments;
        // Outward on a book bound on its left and INWARD on one bound on its right, which is how
        // the other scene lights them: its back is wound the same way round on both, so on the
        // right it faces in, and three turns the normal of a face seen from behind. A shelf of
        // manga is mostly that, and it is the tone its spines were tuned at.
        const normal = unit([-Math.cos(f) / bulge, 0, (side * Math.sin(f)) / half]);
        return { x: hinge + side * bulge * Math.cos(f), z: -half * Math.sin(f), normal, u: side < 0 ? 1 - j / segments : j / segments };
      };
      const lid: P2[] = [];
      for (let j = 0; j <= segments; j++) lid.push([at(j).x, -at(j).z]);
      for (let j = 0; j < segments; j++) {
        const a = at(j);
        const b = at(j + 1);
        // The back runs from the cover round to the back board; which way that is round, seen from
        // outside, depends on the side it is bound on.
        const [first, second] = side < 0 ? [b, a] : [a, b];
        out.quad(
          [first.x, 0, first.z],
          [second.x, 0, second.z],
          [second.x, h, second.z],
          [first.x, h, first.z],
          MATERIAL.spine,
          [[first.u, 0], [second.u, 0], [second.u, 1], [first.u, 1]],
          [first.normal, second.normal, second.normal, first.normal],
        );
      }
      // Its head, closed over in cloth.
      out.cap(outlineOf(lid), 0, MATERIAL.board, () => [0, 0], ([x, y]) => [x, h - 0.5, -y]);
      back = { width: Math.PI * Math.sqrt((bulge * bulge + half * half) / 2), height: h };
    } else {
      const wire = h * 0.07;
      for (const along of [0.205, 0.725]) {
        const x = hinge + side * 0.25;
        const foot = h * (1 - along) - wire;
        for (let n = 0; n < 6; n++) {
          const corner = (k: number) => {
            const turn = (k / 6) * Math.PI * 2;
            return { x: x + 0.6 * Math.sin(turn), z: 0.6 * Math.cos(turn), normal: [Math.sin(turn), 0, Math.cos(turn)] as P3 };
          };
          const a = corner(n);
          const b = corner(n + 1);
          out.quad([a.x, foot, a.z], [b.x, foot, b.z], [b.x, foot + wire, b.z], [a.x, foot + wire, a.z], MATERIAL.staple, undefined, [a.normal, b.normal, b.normal, a.normal]);
          out.triangle([x, foot + wire, 0], [a.x, foot + wire, a.z], [b.x, foot + wire, b.z], MATERIAL.staple);
          out.triangle([x, foot, 0], [b.x, foot, b.z], [a.x, foot, a.z], MATERIAL.staple);
        }
      }
    }
  }
  return { ...out.finish(), back };
}

/** The plank the books stand on: its top, the edge it shows the reader, and the line along it. */
export function buildPlank(): Float32Array {
  const out = new Triangles();
  out.quad([-1500, 0, 80], [1500, 0, 80], [1500, 0, -160], [-1500, 0, -160], MATERIAL.plankTop);
  out.quad([-1500, -12, 80], [1500, -12, 80], [1500, 0, 80], [-1500, 0, 80], MATERIAL.plankFront);
  out.box([0, -0.8, 80.4], [3000, 1.6, 1.6], MATERIAL.rim);
  return out.finish().vertices;
}
