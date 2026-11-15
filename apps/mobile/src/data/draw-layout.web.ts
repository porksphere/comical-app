import type { PageImageLayout } from '@comical/contract';

import type { DrawCopy } from './page-process';

export async function drawLayout(bytes: Uint8Array, layout: PageImageLayout, copies: readonly DrawCopy[], png: boolean): Promise<string> {
  const bitmap = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>]));
  try {
    const canvas = document.createElement('canvas');
    canvas.width = layout.width;
    canvas.height = layout.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d canvas to draw the page on');
    for (const c of copies) ctx.drawImage(bitmap, c.sx, c.sy, c.sw, c.sh, c.dx, c.dy, c.dw, c.dh);
    return png ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.92);
  } finally {
    bitmap.close();
  }
}
