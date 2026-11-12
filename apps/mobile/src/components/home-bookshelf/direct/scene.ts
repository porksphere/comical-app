/**
 * The home bookshelf drawn straight on WebGPU, with no engine between: the shelf `scene.ts` draws
 * with three, to the same measurements and through the same camera, as a handful of buffers and a
 * pipeline to each kind of surface. A draw through three is a walk of its scene and a material's
 * upkeep in an interpreter, four times a book and again for the shadow; here a book is three draws
 * at the most, its place one row of a uniform block, and a frame a hundred calls or so whatever
 * stands on the shelf.
 *
 * Knows nothing of React or of the platform — `ShelfCanvas` hands it a context, and `pixels` the
 * pictures only a platform can make.
 */
import { PRINT } from '@/lib/book-cover';
import type { Rgb, ShelfPlace } from '@/lib/bookshelf';

import type { Pixels } from '../pixels';
import type { ShelfBookSpec, ShelfPicture, ShelfRenderer, SpinePicture } from '../spec';
import { eyeOf, pickBook, sunOverShelf, sunward, viewProjection, writeShelfToWorld, type StageView } from './camera';
import { VERTEX_FLOATS, buildBook, buildPlank, type Run } from './geometry';
import { BOOK_FLOATS, FRAME_FLOATS, MAX_BOOKS, SHADER, SHADOW_SIZE, SHRINK_SHADER, linear } from './shader';

/** One cell of the dither, in points (`DOT_POINTS` in the other scene). */
const DOT_POINTS = 1.5;
const SAMPLES = 4;
const PICTURE_FORMAT: GPUTextureFormat = 'rgba8unorm-srgb';
/** The plank's row of the books' block: the last, which no book is given. */
const PLANK = MAX_BOOKS - 1;
const FORMS = { volume: 0, issue: 1, sheets: 2, scroll: 3 } as const;
// WebGPU's flags by their specified values: the globals of the same names are on the main runtime
// alone, and a renderer with no engine under it is what could one day be drawn from another.
const BUFFER = { COPY_DST: 8, VERTEX: 32, UNIFORM: 64 } as const;
const TEXTURE = { COPY_DST: 2, TEXTURE_BINDING: 4, RENDER_ATTACHMENT: 16 } as const;
const STAGE = { VERTEX: 1, FRAGMENT: 2 } as const;
const rad = (degrees: number) => (degrees * Math.PI) / 180;

/** A cover's pixels on their way to the scene, which drops them once they are a texture. */
export class PixelPicture implements ShelfPicture {
  constructor(public pixels: Pixels | null) {}

  dispose() {
    this.pixels = null;
  }
}

export type DirectSurface = {
  gpu: GPU;
  context: GPUCanvasContext;
  /** The context's canvas, whose size in pixels is set here. */
  canvas: { width: number; height: number };
  drawSpine: (spine: SpinePicture) => Pixels | null;
  /** Puts the finished frame on screen, where the platform doesn't do it for a canvas itself. */
  present?: () => void;
  /** The device was lost, and nothing more will be drawn. */
  onLost?: () => void;
};

type Picture = { texture: GPUTexture; view: GPUTextureView };
type Built = {
  spec: ShelfBookSpec;
  shape: string;
  lettering: string;
  vertices: GPUBuffer;
  /** The runs of its vertices each pipeline draws, and the run that casts its shadow. */
  runs: Record<'plain' | 'cover' | 'spine' | 'casting', Run>;
  spine: Picture | null;
  back?: { width: number; height: number };
  pictures: GPUBindGroup;
};

type Pipelines = Record<'cast' | 'plain' | 'boundCover' | 'looseCover' | 'spine' | 'plank' | 'backdrop' | 'shrink', GPURenderPipeline>;

const hexRgb = (colour: number): Rgb => [colour >> 16, (colour >> 8) & 255, colour & 255];

/** A page colour the theme gives as `#rgb`, `#rrggbb` or `rgb(r, g, b)`. */
function cssColour(colour: string, fallback: Rgb): Rgb {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour.trim())?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
    return hexRgb(parseInt(full, 16));
  }
  const parts = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(colour.trim());
  return parts ? [Number(parts[1]), Number(parts[2]), Number(parts[3])] : fallback;
}

export class DirectScene implements ShelfRenderer {
  private readonly frame = new Float32Array(FRAME_FLOATS);
  private readonly rows = new Float32Array(MAX_BOOKS * BOOK_FLOATS);
  private readonly frameBuffer: GPUBuffer;
  private readonly rowsBuffer: GPUBuffer;
  private readonly plank: { vertices: GPUBuffer; count: number };
  private readonly blank: Picture;
  private readonly shadow: GPUTextureView;
  private readonly lean: GPUBindGroup;
  private readonly full: GPUBindGroup;
  private readonly pictureLayout: GPUBindGroupLayout;
  private readonly shrinkSampler: GPUSampler;
  private targets: { width: number; height: number; colour: GPUTexture; depth: GPUTexture } | null = null;
  private books: Built[] = [];
  private covers = new Map<string, Picture & { aspect: number }>();
  private places: readonly ShelfPlace[] = [];
  private readonly stage: StageView = { width: 1, height: 1, centre: 0.5, yaw: 0, pitch: 0 };
  /** Where each book stood when the shadow was last cast (x, z and its turn), and which were drawn. */
  private readonly cast = new Float64Array(MAX_BOOKS * 3);
  private readonly seen: number[] = [];
  private recast = true;
  private clear: GPUColor = { r: 1, g: 1, b: 1, a: 1 };
  private gone = false;

  /** Starts a scene on a canvas's context. Rejects where there is no WebGPU to draw with, or the
   *  device will not take the shelf's shaders. */
  static async start(surface: DirectSurface): Promise<DirectScene> {
    const adapter = await surface.gpu.requestAdapter();
    if (!adapter) throw new Error('no WebGPU adapter');
    const device = await adapter.requestDevice();
    const format = surface.gpu.getPreferredCanvasFormat();
    surface.context.configure({ device, format, usage: TEXTURE.RENDER_ATTACHMENT, alphaMode: 'opaque' });
    // What a device makes of a wrong shader or pipeline it says later, and only if asked.
    device.pushErrorScope('validation');
    const shader = device.createShaderModule({ code: SHADER });
    const shrinkShader = device.createShaderModule({ code: SHRINK_SHADER });
    const uniform = (binding: number): GPUBindGroupLayoutEntry => ({
      binding,
      visibility: STAGE.VERTEX | STAGE.FRAGMENT,
      buffer: { type: 'uniform' },
    });
    const leanLayout = device.createBindGroupLayout({ entries: [uniform(0), uniform(1)] });
    const fullLayout = device.createBindGroupLayout({
      entries: [
        uniform(0),
        uniform(1),
        { binding: 2, visibility: STAGE.FRAGMENT, texture: { sampleType: 'depth' } },
        { binding: 3, visibility: STAGE.FRAGMENT, sampler: { type: 'comparison' } },
        { binding: 4, visibility: STAGE.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    });
    const pictureLayout = device.createBindGroupLayout({
      entries: [0, 1].map((binding) => ({ binding, visibility: STAGE.FRAGMENT, texture: { sampleType: 'float' as const } })),
    });
    const stride = VERTEX_FLOATS * 4;
    const buffers: GPUVertexBufferLayout[] = [
      {
        arrayStride: stride,
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },
          { shaderLocation: 1, offset: 12, format: 'float32x3' },
          { shaderLocation: 2, offset: 24, format: 'float32x2' },
          { shaderLocation: 3, offset: 32, format: 'float32' },
        ],
      },
    ];
    const lean = device.createPipelineLayout({ bindGroupLayouts: [leanLayout] });
    const unpictured = device.createPipelineLayout({ bindGroupLayouts: [fullLayout] });
    const pictured = device.createPipelineLayout({ bindGroupLayouts: [fullLayout, pictureLayout] });
    // One pipeline to each kind of surface (`shader.ts`), and none draws a face turned from the eye.
    const drawing = (layout: GPUPipelineLayout, entryPoint: string) =>
      device.createRenderPipelineAsync({
        layout,
        vertex: { module: shader, entryPoint: 'vertex', buffers },
        fragment: { module: shader, entryPoint, targets: [{ format }] },
        primitive: { topology: 'triangle-list', cullMode: 'back' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
        multisample: { count: SAMPLES },
      });
    const [cast, plain, boundCover, looseCover, spine, plank, backdrop, shrink] = await Promise.all([
      // Only the faces turned from the light are cast: a face it lights then never shadows itself.
      device.createRenderPipelineAsync({
        layout: lean,
        vertex: { module: shader, entryPoint: 'shadowVertex', buffers },
        primitive: { topology: 'triangle-list', cullMode: 'front' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' },
      }),
      drawing(unpictured, 'plainFragment'),
      drawing(pictured, 'boundCoverFragment'),
      drawing(pictured, 'looseCoverFragment'),
      drawing(pictured, 'spineFragment'),
      drawing(unpictured, 'plankFragment'),
      device.createRenderPipelineAsync({
        layout: lean,
        vertex: { module: shader, entryPoint: 'backdropVertex' },
        fragment: { module: shader, entryPoint: 'backdropFragment', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' },
        multisample: { count: SAMPLES },
      }),
      device.createRenderPipelineAsync({
        layout: 'auto',
        vertex: { module: shrinkShader, entryPoint: 'vertex' },
        fragment: { module: shrinkShader, entryPoint: 'fragment', targets: [{ format: PICTURE_FORMAT }] },
        primitive: { topology: 'triangle-list' },
      }),
    ]);
    const pipelines = { cast, plain, boundCover, looseCover, spine, plank, backdrop, shrink };
    const scene = new DirectScene(surface, device, format, pipelines, { leanLayout, fullLayout, pictureLayout });
    const refused = await device.popErrorScope();
    if (refused) {
      scene.dispose();
      throw new Error(refused.message);
    }
    return scene;
  }

  private constructor(
    private readonly surface: DirectSurface,
    private readonly device: GPUDevice,
    private readonly format: GPUTextureFormat,
    private readonly pipelines: Pipelines,
    layouts: { leanLayout: GPUBindGroupLayout; fullLayout: GPUBindGroupLayout; pictureLayout: GPUBindGroupLayout },
  ) {
    this.pictureLayout = layouts.pictureLayout;
    const block = (floats: number) => device.createBuffer({ size: floats * 4, usage: BUFFER.UNIFORM | BUFFER.COPY_DST });
    this.frameBuffer = block(FRAME_FLOATS);
    this.rowsBuffer = block(MAX_BOOKS * BOOK_FLOATS);
    this.plank = this.vertices(buildPlank());
    this.shrinkSampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
    this.blank = this.pictureOf({ pixels: new Uint8Array([255, 255, 255, 255]), width: 1, height: 1 });
    const shadow = device.createTexture({
      size: [SHADOW_SIZE, SHADOW_SIZE],
      format: 'depth32float',
      usage: TEXTURE.RENDER_ATTACHMENT | TEXTURE.TEXTURE_BINDING,
    });
    this.shadow = shadow.createView();
    const uniforms = [
      { binding: 0, resource: { buffer: this.frameBuffer } },
      { binding: 1, resource: { buffer: this.rowsBuffer } },
    ];
    this.lean = device.createBindGroup({ layout: layouts.leanLayout, entries: uniforms });
    this.full = device.createBindGroup({
      layout: layouts.fullLayout,
      entries: [
        ...uniforms,
        { binding: 2, resource: this.shadow },
        { binding: 3, resource: device.createSampler({ compare: 'less-equal', minFilter: 'linear', magFilter: 'linear' }) },
        { binding: 4, resource: device.createSampler({ minFilter: 'linear', magFilter: 'linear', mipmapFilter: 'linear' }) },
      ],
    });
    this.tone(80, 3, [0.11, 0.11, 0.12], [0.97, 0.97, 0.97], 0, 1);
    this.frame.set(sunward, 52);
    void device.lost?.then((lost) => {
      if (this.gone || lost.reason === 'destroyed') return;
      this.gone = true;
      surface.onLost?.();
    });
  }

  private vertices(data: Float32Array) {
    const vertices = this.device.createBuffer({ size: data.byteLength, usage: BUFFER.VERTEX | BUFFER.COPY_DST });
    this.device.queue.writeBuffer(vertices, 0, data);
    return { vertices, count: data.length / VERTEX_FLOATS };
  }

  /** A picture as a texture with its smaller copies, each drawn from the one above it. */
  private pictureOf({ pixels, width, height }: Pixels): Picture {
    const { device } = this;
    const levels = Math.floor(Math.log2(Math.max(width, height))) + 1;
    const texture = device.createTexture({
      size: [width, height],
      format: PICTURE_FORMAT,
      mipLevelCount: levels,
      usage: TEXTURE.TEXTURE_BINDING | TEXTURE.COPY_DST | TEXTURE.RENDER_ATTACHMENT,
    });
    device.queue.writeTexture({ texture }, pixels, { bytesPerRow: width * 4, rowsPerImage: height }, [width, height]);
    if (levels > 1) {
      const encoder = device.createCommandEncoder();
      for (let level = 1; level < levels; level++) {
        const pass = encoder.beginRenderPass({
          colorAttachments: [{ view: texture.createView({ baseMipLevel: level, mipLevelCount: 1 }), loadOp: 'clear', storeOp: 'store' }],
        });
        pass.setPipeline(this.pipelines.shrink);
        pass.setBindGroup(
          0,
          device.createBindGroup({
            layout: this.pipelines.shrink.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: texture.createView({ baseMipLevel: level - 1, mipLevelCount: 1 }) },
              { binding: 1, resource: this.shrinkSampler },
            ],
          }),
        );
        pass.draw(3);
        pass.end();
      }
      device.queue.submit([encoder.finish()]);
    }
    return { texture, view: texture.createView() };
  }

  private picturesOf(cover: Picture | null, spine: Picture | null): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.pictureLayout,
      entries: [
        { binding: 0, resource: (cover ?? this.blank).view },
        { binding: 1, resource: (spine ?? this.blank).view },
      ],
    });
  }

  private tone(at: number, levels: number, lo: Rgb | readonly number[], hi: Rgb | readonly number[], from: number, to: number) {
    this.frame.set([lo[0], lo[1], lo[2], levels, hi[0], hi[1], hi[2], 0, from, to, 0, 0], at);
  }

  private colour(at: number, [r, g, b]: Rgb, w = 0) {
    this.frame.set([linear(r), linear(g), linear(b), w], at);
  }

  resize(width: number, height: number, pixelRatio: number, centre = width / 2) {
    if (!width || !height) return;
    Object.assign(this.stage, { width, height, centre });
    this.frame.set(viewProjection(this.stage), 0);
    this.frame.set(sunOverShelf(this.stage), 32);
    this.frame.set(eyeOf(this.stage), 48);
    this.recast = true;
    this.surface.canvas.width = Math.max(1, Math.floor(width * pixelRatio));
    this.surface.canvas.height = Math.max(1, Math.floor(height * pixelRatio));
    const dot = Math.max(1, Math.floor(DOT_POINTS * pixelRatio + 0.25));
    this.frame[51] = dot;
    this.frame[55] = dot / DOT_POINTS;
  }

  setView(yaw: number, pitch: number) {
    this.stage.yaw = yaw;
    this.stage.pitch = pitch;
  }

  setTheme(dark: boolean, background: string) {
    const page = cssColour(background, dark ? [0, 0, 0] : [255, 255, 255]);
    this.clear = { r: page[0] / 255, g: page[1] / 255, b: page[2] / 255, a: 1 };
    this.colour(56, page);
    if (dark) {
      this.colour(60, hexRgb(0x55555a));
      this.colour(64, hexRgb(0x48484c));
      this.colour(68, hexRgb(0x2a2a2d));
      this.colour(72, hexRgb(0x77777c));
      this.tone(92, 1, [0, 0, 0], [0.44, 0.44, 0.455], 0.2, 1.5);
      this.tone(104, 1, [0, 0, 0], [0.44, 0.44, 0.455], 0, 1);
    } else {
      this.colour(60, hexRgb(0xb4b4b9));
      this.colour(64, hexRgb(0xffffff));
      this.colour(68, hexRgb(0xc4c4c9));
      this.colour(72, hexRgb(0x1c1c1e));
      this.tone(92, 1, [0.17, 0.17, 0.185], [1, 1, 1], 0.5, 0.99);
      this.tone(104, 1, [0.17, 0.17, 0.185], [1, 1, 1], 0, 1);
    }
  }

  /** The books on the shelf, in order. A book's triangles are made again only when its shape
   *  changed, and its spine lettered again only when what is lettered on it did. */
  setBooks(specs: readonly ShelfBookSpec[]) {
    const kept = new Map(this.books.map((b) => [b.spec.key, b]));
    this.books = specs.slice(0, PLANK).map((spec) => {
      const shape = [spec.cover.form, spec.cover.binding, spec.width, spec.height, spec.depth].join('|');
      const lettering = [spec.title, spec.number, spec.board, spec.ink].join('|');
      const had = kept.get(spec.key);
      kept.delete(spec.key);
      if (had && had.shape === shape && had.lettering === lettering) return { ...had, spec };
      let geometry: Pick<Built, 'vertices' | 'runs' | 'back'> | undefined = had?.shape === shape ? had : undefined;
      if (!geometry) {
        had?.vertices.destroy();
        const { vertices, back, ...runs } = buildBook(spec);
        geometry = { vertices: this.vertices(vertices).vertices, runs, back };
      }
      had?.spine?.texture.destroy();
      const { title, number, board, ink } = spec;
      const drawn = geometry.back ? this.surface.drawSpine({ title, number, board, ink, ...geometry.back }) : null;
      const spine = drawn ? this.pictureOf(drawn) : null;
      return { ...geometry, spec, shape, lettering, spine, pictures: this.picturesOf(this.covers.get(spec.key) ?? null, spine) };
    });
    for (const gone of kept.values()) this.discard(gone);
    this.books.forEach((book, index) => this.describe(book, index));
    this.recast = true;
  }

  /** A book's cover picture, once it has loaded; `aspect` is the picture's own shape. */
  setCover(key: string, picture: PixelPicture, aspect: number) {
    const { pixels } = picture;
    picture.dispose();
    if (!pixels || this.gone) return;
    this.covers.get(key)?.texture.destroy();
    this.covers.set(key, { ...this.pictureOf(pixels), aspect });
    const index = this.books.findIndex((b) => b.spec.key === key);
    if (index < 0) return;
    const book = this.books[index];
    book.pictures = this.picturesOf(this.covers.get(key)!, book.spine);
    this.describe(book, index);
  }

  /** A book's row of the uniform block, all but its place: its cloth, its lettering's colour, how
   *  its picture is cropped to its face, and what kind of book it is. */
  private describe({ spec, spine }: Built, index: number) {
    const at = index * BOOK_FLOATS;
    const cover = this.covers.get(spec.key);
    const { width, height, cover: kind } = spec;
    const board = spec.board.map(linear);
    const border = kind.form === 'sheets' ? PRINT.border * width : 0;
    // Cropped to the face about its middle, never stretched to it.
    const face = (width - 2 * border) / (height - 2 * border);
    const across = cover ? Math.min(1, face / cover.aspect) : 1;
    const up = cover ? Math.min(1, cover.aspect / face) : 1;
    this.rows.set(
      [
        ...[board[0], board[1], board[2], cover ? 1 : 0],
        ...[board[0], board[1], board[2], spine ? 1 : 0],
        ...[linear(spec.ink[0]), linear(spec.ink[1]), linear(spec.ink[2]), width / height],
        ...[across, up, (1 - across) / 2, (1 - up) / 2],
        ...[FORMS[kind.form], kind.binding === 'left' ? 1 : 0, 0, 0],
      ],
      at + 4,
    );
  }

  private discard(book: Built) {
    book.vertices.destroy();
    book.spine?.texture.destroy();
  }

  private targetsFor(width: number, height: number) {
    if (this.targets?.width !== width || this.targets.height !== height) {
      this.targets?.colour.destroy();
      this.targets?.depth.destroy();
      const target = (format: GPUTextureFormat) =>
        this.device.createTexture({ size: [width, height], format, sampleCount: SAMPLES, usage: TEXTURE.RENDER_ATTACHMENT });
      this.targets = { width, height, colour: target(this.format), depth: target('depth24plus') };
    }
    return this.targets;
  }

  /** Draws the shelf with each book at its place; `ink` off leaves every book in colour. */
  render(places: readonly ShelfPlace[], ink: boolean) {
    if (this.gone) return;
    const { device, frame, rows, stage } = this;
    this.places = places;
    const screen = this.surface.context.getCurrentTexture();
    const targets = this.targetsFor(screen.width, screen.height);

    writeShelfToWorld(frame, 16, stage);
    frame[76] = screen.width;
    frame[77] = screen.height;
    // Only what stands in the view, or near enough beside it to throw its shadow in, is drawn.
    const reach = Math.max(stage.centre, stage.width - stage.centre) * 1.15 + 120;
    const { seen, cast: stood } = this;
    let moved = this.recast;
    seen.length = 0;
    this.books.forEach(({ spec }, index) => {
      const place = places[index];
      if (!place) return;
      if (stood[index * 3] !== place.x || stood[index * 3 + 1] !== place.z || stood[index * 3 + 2] !== place.yaw) {
        stood[index * 3] = place.x;
        stood[index * 3 + 1] = place.z;
        stood[index * 3 + 2] = place.yaw;
        moved = true;
      }
      const at = index * BOOK_FLOATS;
      rows[at] = place.x;
      rows[at + 1] = place.z;
      rows[at + 2] = rad(place.yaw);
      rows[at + 3] = ink ? place.ink : 0;
      if (Math.abs(place.x) - (spec.width + spec.depth) / 2 < reach) seen.push(index);
    });
    device.queue.writeBuffer(this.frameBuffer, 0, frame);
    device.queue.writeBuffer(this.rowsBuffer, 0, rows);

    const encoder = device.createCommandEncoder();
    // The shadow goes with the shelf (`sunOverShelf`), so it is cast again only when a book has
    // moved: a shelf that only stands and drifts casts none.
    if (moved) {
      this.recast = false;
      const cast = encoder.beginRenderPass({
        colorAttachments: [],
        depthStencilAttachment: { view: this.shadow, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
      });
      cast.setPipeline(this.pipelines.cast);
      cast.setBindGroup(0, this.lean);
      for (const index of seen) {
        const book = this.books[index];
        cast.setVertexBuffer(0, book.vertices);
        cast.draw(book.runs.casting.count, 1, book.runs.casting.first, index);
      }
      cast.end();
    }

    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: targets.colour.createView(), resolveTarget: screen.createView(), clearValue: this.clear, loadOp: 'clear', storeOp: 'discard' }],
      depthStencilAttachment: { view: targets.depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' },
    });
    pass.setPipeline(this.pipelines.backdrop);
    pass.setBindGroup(0, this.lean);
    pass.draw(3);
    pass.setPipeline(this.pipelines.plank);
    pass.setBindGroup(0, this.full);
    pass.setVertexBuffer(0, this.plank.vertices);
    pass.draw(this.plank.count, 1, 0, PLANK);
    // A pipeline at a time across the books, not a book at a time across the pipelines.
    const each = (pipeline: GPURenderPipeline, run: 'plain' | 'cover' | 'spine', pictured: boolean, bound?: boolean) => {
      pass.setPipeline(pipeline);
      for (const index of seen) {
        const book = this.books[index];
        const { first, count } = book.runs[run];
        if (!count || (bound !== undefined && bound !== FORMS[book.spec.cover.form] < 2)) continue;
        if (pictured) pass.setBindGroup(1, book.pictures);
        pass.setVertexBuffer(0, book.vertices);
        pass.draw(count, 1, first, index);
      }
    };
    each(this.pipelines.plain, 'plain', false);
    each(this.pipelines.boundCover, 'cover', true, true);
    each(this.pipelines.looseCover, 'cover', true, false);
    each(this.pipelines.spine, 'spine', true);
    pass.end();
    device.queue.submit([encoder.finish()]);
    this.surface.present?.();
  }

  /** The book under a point of the stage, or -1. */
  pick(x: number, y: number): number {
    return pickBook(
      this.stage,
      this.books.map(({ spec }) => ({ width: spec.width, height: spec.height, depth: spec.depth, binding: spec.cover.binding, hard: spec.cover.form === 'volume' })),
      this.places,
      x,
      y,
    );
  }

  drawn() {
    return this.gone ? undefined : this.device.queue.onSubmittedWorkDone();
  }

  dispose() {
    this.gone = true;
    this.device.destroy();
  }
}
