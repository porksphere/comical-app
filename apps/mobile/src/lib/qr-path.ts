/**
 * A QR code as one SVG path. `toqr` hands back the symbol's modules as a square, row-major
 * `Uint8Array` (1 = dark); drawing each dark module as a unit square in one path keeps the SVG to
 * a single node whatever the version. The quiet zone is the caller's: it is whitespace around the
 * symbol, which is the drawn box's padding.
 */
import { toQR } from 'toqr';

export interface QrPath {
  /** Modules per side. */
  size: number;
  /** In module units: draw it in a `0 0 size size` viewBox. */
  d: string;
}

export function qrPath(content: string): QrPath {
  const modules = toQR(content);
  const size = Math.round(Math.sqrt(modules.length));
  if (size * size !== modules.length) throw new Error('qr: not a square symbol');
  const runs: string[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; ) {
      if (!modules[y * size + x]) {
        x++;
        continue;
      }
      // A run of dark modules in a row is one rectangle, not several: fewer path segments, and no
      // hairline seams between them at fractional scales.
      let end = x + 1;
      while (end < size && modules[y * size + end]) end++;
      runs.push(`M${x} ${y}h${end - x}v1h${x - end}z`);
      x = end;
    }
  }
  return { size, d: runs.join('') };
}
