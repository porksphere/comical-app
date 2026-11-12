import { describe, expect, test } from 'bun:test';

import type { CoverBinding, CoverForm } from '@/lib/book-cover';

import type { ShelfBookSpec } from '../spec';
import { spineBulge } from './camera';
import { MATERIAL, VERTEX_FLOATS, buildBook, buildPlank } from './geometry';

const spec = (form: CoverForm, binding: CoverBinding): ShelfBookSpec => ({
  key: `${form}:${binding}`,
  title: 'Salt & Cinder',
  cover: { form, binding },
  width: 130,
  height: 196,
  depth: form === 'volume' ? 28 : 6,
  board: [60, 40, 30],
  ink: [244, 242, 236],
});

const FORMS: CoverForm[] = ['volume', 'issue', 'sheets', 'scroll'];
const BINDINGS: CoverBinding[] = ['left', 'right'];

type Corner = { at: number[]; normal: number[]; uv: number[]; material: number };
function triangles(vertices: Float32Array): Corner[][] {
  const corners: Corner[] = [];
  for (let n = 0; n < vertices.length; n += VERTEX_FLOATS) {
    const v = Array.from(vertices.subarray(n, n + VERTEX_FLOATS));
    corners.push({ at: v.slice(0, 3), normal: v.slice(3, 6), uv: v.slice(6, 8), material: v[8] });
  }
  return corners.reduce<Corner[][]>((all, corner, n) => (n % 3 ? all[all.length - 1].push(corner) : all.push([corner]), all), []);
}

describe('a book’s triangles', () => {
  test('stand on the shelf, inside the book’s own box', () => {
    for (const form of FORMS) {
      for (const binding of BINDINGS) {
        const book = spec(form, binding);
        const { vertices } = buildBook(book);
        expect(vertices.length % (VERTEX_FLOATS * 3)).toBe(0);
        expect(vertices.every(Number.isFinite)).toBe(true);
        // A set's prints lean; a hard cover's back, a slab's rim and an issue's staples stand out
        // past the cover's own width.
        const lean = form === 'sheets' ? 32 : 0;
        const back = form === 'volume' ? spineBulge(book.depth) : 1;
        // A slab's bevel is added round it, its foot's included: the plank hides that much.
        const rim = form === 'scroll' ? 0.9 : 0;
        for (const triangle of triangles(vertices)) {
          for (const { at } of triangle) {
            expect(Math.abs(at[0])).toBeLessThanOrEqual(book.width / 2 + back + lean + 0.01);
            expect(at[1]).toBeGreaterThanOrEqual(-rim - 0.01);
            expect(at[1]).toBeLessThanOrEqual(book.height + lean + rim + 0.01);
            expect(Math.abs(at[2])).toBeLessThanOrEqual(book.depth / 2 + 0.06);
          }
        }
      }
    }
  });

  test('face outward: a flat face’s normal is the way it is wound', () => {
    for (const form of FORMS) {
      for (const binding of BINDINGS) {
        for (const [a, b, c] of triangles(buildBook(spec(form, binding)).vertices)) {
          // A rounded back and a staple carry normals of their own.
          if (a.material === MATERIAL.spine || a.material === MATERIAL.staple) continue;
          const u = b.at.map((v, i) => v - a.at[i]);
          const w = c.at.map((v, i) => v - a.at[i]);
          const wound = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
          const area = Math.hypot(...wound);
          if (area < 1e-9) continue;
          const facing = wound.reduce((sum, v, i) => sum + (v / area) * a.normal[i], 0);
          expect(facing).toBeCloseTo(1, 4);
        }
      }
    }
  });

  test('carry a cover whose picture runs corner to corner the right way up', () => {
    for (const form of ['volume', 'issue'] as const) {
      for (const binding of BINDINGS) {
        const book = spec(form, binding);
        const cover = triangles(buildBook(book).vertices)
          .flat()
          .filter((corner) => corner.material === MATERIAL.cover);
        expect(cover.length).toBeGreaterThan(0);
        for (const { at, uv, normal } of cover) {
          expect(normal[2]).toBeCloseTo(1, 5);
          // Left of the picture is the book's left, its foot the picture's foot.
          expect(uv[0]).toBeCloseTo((at[0] + book.width / 2) / book.width, 1);
          expect(uv[1]).toBeCloseTo(at[1] / book.height, 1);
        }
      }
    }
  });

  test('put what casts the shadow first', () => {
    for (const form of FORMS) {
      const { vertices, casting } = buildBook(spec(form, 'left'));
      expect(casting).toBeGreaterThan(0);
      expect(casting % 3).toBe(0);
      expect(casting).toBeLessThanOrEqual(vertices.length / VERTEX_FLOATS);
    }
  });

  test('letter only a hard cover’s back', () => {
    expect(buildBook(spec('volume', 'right')).spine).toBeDefined();
    for (const form of ['issue', 'sheets', 'scroll'] as const) expect(buildBook(spec(form, 'right')).spine).toBeUndefined();
  });
});

test('the plank lies under the books, its top at their feet', () => {
  const corners = triangles(buildPlank()).flat();
  const top = corners.filter((corner) => corner.material === MATERIAL.plankTop);
  expect(top.every(({ at, normal }) => at[1] === 0 && normal[1] === 1)).toBe(true);
  expect(corners.every(({ at }) => at[1] <= 0)).toBe(true);
});
