import type { BookCover } from '@/lib/book-cover';
import type { Rgb, ShelfPlace } from '@/lib/bookshelf';

export type ShelfBookSpec = {
  key: string;
  title: string;
  /** A volume's number, lettered at the foot of its spine. */
  number?: string;
  cover: BookCover;
  width: number;
  height: number;
  depth: number;
  board: Rgb;
  ink: Rgb;
};

export type SpinePicture = { title: string; number?: string; board: Rgb; ink: Rgb; width: number; height: number };

/** A cover's picture as its renderer made it. Nothing outside that renderer looks inside one. */
export type ShelfPicture = { dispose(): void };

/** A cover as a renderer's `loadCover` hands it over: its picture, the picture's own shape, and the
 *  cloth read off it. */
export type ShelfCover = { picture: ShelfPicture; aspect: number; board: Rgb };

/**
 * What draws the shelf. There are two: three's scene (`scene.ts`) and the one written straight on
 * WebGPU (`direct/scene.ts`), each taking the pictures its own `loadCover` makes, which is why a
 * shelf keeps to one renderer for as long as it is mounted.
 */
export interface ShelfRenderer {
  resize(width: number, height: number, pixelRatio: number, centre?: number): void;
  setView(yaw: number, pitch: number): void;
  setTheme(dark: boolean, background: string): void;
  setBooks(specs: readonly ShelfBookSpec[]): void;
  setCover(key: string, picture: ShelfPicture, aspect: number): void;
  render(places: readonly ShelfPlace[], ink: boolean): void;
  pick(x: number, y: number): number;
}
