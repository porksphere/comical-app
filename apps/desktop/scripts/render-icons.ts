/**
 * Render the desktop icons from the master mark (`apps/mobile/assets/images/logo.svg`).
 *
 *   bun run icons        (from apps/desktop — then commit what lands in assets/)
 *
 * The mobile rasters sit the book on an opaque near-black tile: right for a launcher that masks its
 * icons, wrong for a Windows taskbar or a Linux dock, which draw an icon as given — a black square
 * with a small book in it. These are the book alone, cropped to its own bounds, on transparent.
 *
 * Electron is the rasterizer because it is already a dependency here and is the same Chromium the
 * mobile rasters were made with (see ICONS.md).
 */
import { app, BrowserWindow } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DESKTOP = process.cwd();
const LOGO = join(DESKTOP, "..", "mobile", "assets", "images", "logo.svg");
const OUT = join(DESKTOP, "assets");

/** Every size Windows asks for between 100% and 400% scaling, small icon through jumbo. Each is
 *  drawn from the vector at its own size: Windows scales whatever it can't find, and badly. */
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 256];
const PNG_SIZE = 512;
/** Margin per side, as a fraction of the frame. */
const PAD = 0.02;

type Raster = { size: number; png: string; rgba: number[] | null };

/** Runs in the page. `rgba` only for the sizes that are stored as bitmaps. */
async function rasterize(svgText: string, sizes: number[], pad: number, bitmapBelow: number): Promise<Raster[]> {
  document.body.innerHTML = svgText;
  const svg = document.querySelector("svg")!;
  const box = svg.getBBox();
  const side = Math.max(box.width, box.height) / (1 - 2 * pad);
  svg.setAttribute("viewBox", `${box.x + box.width / 2 - side / 2} ${box.y + box.height / 2 - side / 2} ${side} ${side}`);

  const out: Raster[] = [];
  for (const size of sizes) {
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(svg));
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, size, size);
    out.push({
      size,
      png: canvas.toDataURL("image/png"),
      rgba: size < bitmapBelow ? Array.from(ctx.getImageData(0, 0, size, size).data) : null,
    });
  }
  return out;
}

const pngBytes = (raster: Raster): Buffer => Buffer.from(raster.png.slice(raster.png.indexOf(",") + 1), "base64");

/** A 32-bit DIB as an .ico stores it: double height, rows bottom-up, BGRA, then the 1-bit mask. */
function dib(size: number, rgba: number[]): Buffer {
  const pixels = size * size * 4;
  const maskRow = Math.ceil(size / 32) * 4;
  const buf = Buffer.alloc(40 + pixels + maskRow * size);
  buf.writeUInt32LE(40, 0);
  buf.writeInt32LE(size, 4);
  buf.writeInt32LE(size * 2, 8);
  buf.writeUInt16LE(1, 12);
  buf.writeUInt16LE(32, 14);
  buf.writeUInt32LE(pixels + maskRow * size, 20);
  for (let y = 0; y < size; y++) {
    const row = size - 1 - y;
    for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 4;
      const dst = 40 + (row * size + x) * 4;
      buf[dst] = rgba[src + 2]!;
      buf[dst + 1] = rgba[src + 1]!;
      buf[dst + 2] = rgba[src]!;
      buf[dst + 3] = rgba[src + 3]!;
      if (rgba[src + 3] === 0) buf[40 + pixels + row * maskRow + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  }
  return buf;
}

/** Bitmaps below 256 and a PNG at 256 — the layout every consumer of an .ico (the shell, the
 *  resource compiler, NSIS) is sure to read. */
function ico(rasters: Raster[]): Buffer {
  const images = rasters.map((r) => (r.rgba ? dib(r.size, r.rgba) : pngBytes(r)));
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((image, i) => {
    const entry = 6 + 16 * i;
    const size = rasters[i]!.size;
    header[entry] = header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.length;
  });
  return Buffer.concat([header, ...images]);
}

app
  .whenReady()
  .then(async () => {
    const win = new BrowserWindow({ show: false });
    await win.loadURL("about:blank");
    const svg = await readFile(LOGO, "utf8");
    const args = [svg, [...ICO_SIZES, PNG_SIZE], PAD, 256].map((arg) => JSON.stringify(arg)).join(",");
    const rasters = (await win.webContents.executeJavaScript(`(${rasterize.toString()})(${args})`)) as Raster[];

    await mkdir(OUT, { recursive: true });
    await writeFile(join(OUT, "icon.ico"), ico(rasters.filter((r) => ICO_SIZES.includes(r.size))));
    await writeFile(join(OUT, "icon.png"), pngBytes(rasters.find((r) => r.size === PNG_SIZE)!));
    console.log(`icons → ${OUT}`);
  })
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => app.quit());
