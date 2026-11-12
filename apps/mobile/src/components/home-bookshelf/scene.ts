/**
 * The home bookshelf as a lit scene: books of real thickness standing on a shelf, the one in front
 * in colour and the rest drawn in the app's screentone. Knows nothing of React or of the platform —
 * `ShelfCanvas` hands it a renderer, `pictures` the textures only a platform can make.
 *
 * Its space is `lib/bookshelf`'s: points, `y` up from the shelf's top, `z` toward the reader.
 */
import {
  Fn,
  clamp,
  dot,
  float,
  abs,
  floor,
  fract,
  length,
  materialColor,
  max,
  min,
  mix,
  mod,
  normalLocal,
  output,
  positionLocal,
  sRGBTransferEOTF,
  sRGBTransferOETF,
  screenCoordinate,
  screenUV,
  sin,
  smoothstep,
  step,
  uniform,
  userData,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import * as THREE from 'three/webgpu';

import { SHELF, cssRgb, type Rgb, type ShelfPlace } from '@/lib/bookshelf';
import { PRINT, type BookCover } from '@/lib/book-cover';

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

const PAPER = '#F1EBDD';
/** One cell of the dither, in points — half again the page curl's on a 3× screen, where its own
 *  three device pixels read as a grey rather than as tone on a face this small. */
const DOT_POINTS = 1.5;
const rad = (degrees: number) => (degrees * Math.PI) / 180;
const colour = ([r, g, b]: Rgb) => new THREE.Color(cssRgb([r, g, b]));

const tone = (levels: number) => ({
  levels: uniform(levels),
  from: uniform(0),
  to: uniform(1),
  lo: uniform(new THREE.Vector3(0.11, 0.11, 0.12)),
  hi: uniform(new THREE.Vector3(0.97, 0.97, 0.97)),
});
type Tone = ReturnType<typeof tone>;
/** What a material has lit, before the renderer turns it to the screen's colours. */
const lit = output as unknown as THREE.Node<'vec4'>;
/** The fragment's place on the screen, in device pixels. */
const pixel = screenCoordinate as unknown as THREE.Node<'vec2'>;
const vec3Of = (node: THREE.Node) => node as unknown as THREE.Node<'vec3'>;

/**
 * Several pieces as one geometry, so what is one material is one draw. A draw is cheap for the
 * GPU and dear here: each is a trip through three in an interpreter, twice a frame with the
 * shadow's pass, and a book of loose boxes with a material a face was sixteen of them.
 */
function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map((part) => (part.index ? part.toNonIndexed() : part));
  const out = new THREE.BufferGeometry();
  for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2]] as const) {
    const data = new Float32Array(flat.reduce((n, g) => n + g.attributes[name].count * size, 0));
    let at = 0;
    for (const g of flat) {
      data.set(g.attributes[name].array, at);
      at += g.attributes[name].count * size;
    }
    out.setAttribute(name, new THREE.BufferAttribute(data, size));
  }
  for (const g of new Set([...parts, ...flat])) g.dispose();
  return out;
}

/** How a set's two prints stand: each one's lean in degrees, and how far the one behind sits
 *  toward the binding's side, of the width. The card's own picture of a set (`PRINT.tilt`) turned
 *  further and pulled apart, since on a shelf it has a row of books to be told from. */
const PRINT_LEAN = { front: -3, behind: 8.5, aside: 0.07 } as const;

/** A book as built; `behind` is the picture on a set's second print. */
type Built = {
  group: THREE.Group;
  coverMaterial: THREE.MeshStandardNodeMaterial | null;
  behind: THREE.MeshStandardNodeMaterial | null;
};

export class ShelfScene {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 20, 6000);
  private readonly pivot = new THREE.Group();
  private readonly floor = new THREE.Group();
  private readonly key = new THREE.DirectionalLight(0xffffff, 2.6);
  private readonly dot = uniform(2);
  private readonly bookTone = tone(3);
  private readonly plankTone = tone(1);
  private readonly backdropTone = uniform(new THREE.Color());
  private readonly paper = uniform(new THREE.Color());
  private readonly plankTop: THREE.MeshStandardNodeMaterial;
  private readonly plankEdge: THREE.MeshStandardNodeMaterial;
  private readonly rim = new THREE.MeshBasicNodeMaterial();
  private readonly shared: { print: THREE.Material; block: THREE.Material; staple: THREE.Material };
  private readonly inkedBook: ReturnType<ShelfScene['inked']>;
  private readonly inkedSpine: ReturnType<ShelfScene['inked']>;
  private readonly ray = new THREE.Raycaster();
  private books: (Built & { spec: ShelfBookSpec; signature: string })[] = [];
  private covers = new Map<string, { texture: THREE.Texture; aspect: number }>();
  private size = { width: 1, height: 1 };
  /** Where the books stood when their shadow was last cast. */
  private cast = '';

  constructor(
    private readonly renderer: THREE.WebGPURenderer,
    private readonly drawSpine: (spine: SpinePicture) => THREE.Texture | null,
    /** Puts the finished frame on screen, where the platform doesn't do it for a canvas itself. */
    private readonly present: () => void = () => {},
  ) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.add(this.pivot);
    this.pivot.add(this.floor);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x9a948a, 1.7));
    this.key.castShadow = true;
    // Cast again only when a book has moved (`render`): half of a frame's draws are the shadow's,
    // and a shelf that stands and drifts would cast the same one thirty times a second.
    this.key.shadow.autoUpdate = false;
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.bias = -0.0006;
    this.key.shadow.normalBias = 0.6;
    Object.assign(this.key.shadow.camera, { left: -380, right: 380, top: 380, bottom: -380, near: 100, far: 2400 });
    this.key.position.set(-250, 620, 560);
    this.key.target.position.set(0, 100, 0);
    this.scene.add(this.key, this.key.target);

    const shelved = userData('ink', 'float') as unknown as THREE.Node<'float'>;
    this.inkedBook = this.inked(shelved, this.bookTone);
    this.inkedSpine = this.lettered(shelved, this.bookTone);
    // Cut paper seen edge on: sheets stacked through the book's thickness, which is the block's own
    // depth on its fore-edge and on its head and foot alike, so one rule draws all three.
    const block = this.matte({});
    block.colorNode = Fn(() => {
      const through = (positionLocal as unknown as THREE.Node<'vec3'>).z;
      const cut = mix(uniform(new THREE.Color(PAPER)), uniform(new THREE.Color('#CFC4AA')), step(0.5, fract(through.div(1.6))));
      // Its front and back are the first and last page, which an opening cover shows.
      return mix(cut, uniform(new THREE.Color(PAPER)), step(0.5, abs((normalLocal as unknown as THREE.Node<'vec3'>).z)));
    })();
    this.shared = {
      print: this.matte({ color: new THREE.Color('#FBFAF7'), roughness: 0.85 }),
      block,
      staple: new THREE.MeshStandardNodeMaterial({ color: 0xd8dde4, metalness: 1, roughness: 0.3 }),
    };

    // The shelf is always ink: its light is the page and the shadows the books cast on it are tone.
    this.plankTop = new THREE.MeshStandardNodeMaterial({ roughness: 1 });
    this.plankTop.outputNode = this.inked(float(1), this.plankTone);
    const edgeTone = { ...this.plankTone, from: uniform(0), to: uniform(1) };
    this.plankEdge = new THREE.MeshStandardNodeMaterial({ roughness: 1 });
    this.plankEdge.outputNode = this.inked(float(1), edgeTone);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(3000, 240).rotateX(-Math.PI / 2), this.plankTop);
    top.position.set(0, 0, -40);
    top.receiveShadow = true;
    const edge = new THREE.Mesh(new THREE.PlaneGeometry(3000, 12), this.plankEdge);
    edge.position.set(0, -6, 80);
    const rim = new THREE.Mesh(new THREE.BoxGeometry(3000, 1.6, 1.6), this.rim);
    rim.position.set(0, -0.8, 80.4);
    this.floor.add(top, edge, rim);

    // Behind everything, a tone that thickens toward the stage's edges, in the books' own dither at
    // a point to a cell. Drawn in the scene rather than under it: a canvas is opaque on Android.
    const backdrop = new THREE.MeshBasicNodeMaterial({ depthWrite: false, depthTest: false });
    backdrop.colorNode = Fn(() => {
      const at = screenUV as unknown as THREE.Node<'vec2'>;
      const fromMiddle = length(at.sub(vec2(0.5, 0.46)).mul(vec2(1, 1.2))).div(0.7071);
      // Thinning out again at the stage's top and bottom, so the row has no edge against the feed.
      const within = smoothstep(0, 0.2, at.y).mul(smoothstep(0, 0.2, at.y.oneMinus()));
      const strength = smoothstep(0.5, 1, fromMiddle).mul(0.32).mul(within);
      const cell = floor(pixel.div(this.dot.div(DOT_POINTS)));
      return mix(this.paper, this.backdropTone, step(this.bayer(cell), strength));
    })();
    // Its colour is read off the screen, so all the sheet has to do is cover the view.
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), backdrop);
    sky.position.z = -2000;
    sky.renderOrder = -1;
    this.scene.add(sky);
  }

  /** The 4×4 Bayer threshold of a cell: the page curl's matrix (`page-curl-shader.ts`). */
  private readonly bayer = Fn(([cell]: [THREE.Node<'vec2'>]) => {
    const q = mod(cell, 4);
    const x0 = mod(q.x, 2);
    const y0 = mod(q.y, 2);
    const x1 = floor(q.x.div(2));
    const y1 = floor(q.y.div(2));
    return mod(x0.add(y0), 2).mul(8).add(y0.mul(4)).add(mod(x1.add(y1), 2).mul(2)).add(y1).div(16).add(1 / 32);
  });

  /**
   * A lit colour drawn as tone: its brightness as shown on screen, cut to `levels` steps by an
   * ordered dither between an ink and a paper, and laid over the colour by `ink` (0 leaves it be).
   */
  private inked(ink: THREE.Node<'float'>, t: Tone) {
    return Fn(() => {
      const shown = vec3Of(sRGBTransferOETF(lit.xyz));
      const light = clamp(dot(shown, vec3(0.2126, 0.7152, 0.0722)).sub(t.from).div(t.to.sub(t.from)), 0, 1);
      const cell = floor(pixel.div(this.dot));
      const step = clamp(floor(light.mul(t.levels).add(this.bayer(cell))).div(t.levels), 0, 1);
      return vec4(mix(lit.xyz, vec3Of(sRGBTransferEOTF(mix(t.lo, t.hi, step))), ink), lit.w);
    })();
  }

  /**
   * A spine's tone. Its cloth is cut to the covers' own steps, coarse as the rest of the shelf, but
   * its lettering is laid on solid — light on a cloth that comes out dark and dark on one that
   * comes out light — because a title a few points high cut to four steps was the dither eating
   * its strokes, and at steps fine enough to keep them the spine stopped being tone. What is
   * lettering is read off the picture itself: how far its colour is from the cloth's (`cloth`)
   * toward the lettering's (`letter`), both on the mesh.
   */
  private lettered(ink: THREE.Node<'float'>, t: Tone) {
    const cloth = userData('cloth', 'color') as unknown as THREE.Node<'vec3'>;
    const letter = userData('letter', 'color') as unknown as THREE.Node<'vec3'>;
    return Fn(() => {
      const luma = vec3(0.2126, 0.7152, 0.0722);
      const surface = vec3Of((materialColor as unknown as THREE.Node<'vec4'>).xyz);
      const across = letter.sub(cloth);
      const lettering = clamp(dot(surface.sub(cloth), across).div(max(dot(across, across), 0.0001)), 0, 1);
      // The light that fell here as a share of the surface's own colour, which is what the cloth
      // alone would have shown: the cloth's tone must not change under a letter.
      const fell = dot(lit.xyz, luma).div(max(dot(surface, luma), 0.02));
      const bare = clamp(fell.mul(dot(cloth, luma)), 0, 1);
      const shown = vec3Of(sRGBTransferOETF(vec3(bare))).x;
      const light = clamp(shown.sub(t.from).div(t.to.sub(t.from)), 0, 1);
      const cell = floor(pixel.div(this.dot));
      const toned = clamp(floor(light.mul(t.levels).add(this.bayer(cell))).div(t.levels), 0, 1);
      const tone = mix(toned, step(light, 0.5), lettering);
      return vec4(mix(lit.xyz, vec3Of(sRGBTransferEOTF(mix(t.lo, t.hi, tone))), ink), lit.w);
    })();
  }

  private matte(parameters: THREE.MeshStandardNodeMaterialParameters) {
    const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, ...parameters });
    material.outputNode = this.inkedBook;
    return material;
  }

  private glossy(parameters: THREE.MeshStandardNodeMaterialParameters) {
    const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.5, ...parameters });
    material.outputNode = this.inkedBook;
    return material;
  }

  /** The stage's size in points, and where along its width the shelf's middle stands. The camera
   *  is `projectToStage`'s: the eye `lens` back, level with 44% down the stage and square on to
   *  `centre`, which `setViewOffset` takes as a window on a larger view centred on that line. */
  resize(width: number, height: number, pixelRatio: number, centre = width / 2) {
    if (!width || !height) return;
    this.size = { width, height };
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.dot.value = Math.max(1, Math.floor(DOT_POINTS * pixelRatio + 0.25));
    const { camera } = this;
    camera.fov = (2 * Math.atan((0.56 * height) / SHELF.lens) * 180) / Math.PI;
    const reach = Math.max(centre, width - centre);
    camera.aspect = (2 * reach) / (1.12 * height);
    camera.position.set(0, 0.56 * height - SHELF.floor, SHELF.lens);
    camera.setViewOffset(2 * reach, 1.12 * height, reach - centre, 0.12 * height, width, height);
    const middle = height / 2 - SHELF.floor;
    this.pivot.position.set(0, middle, 0);
    this.setView(0, 0);
    this.floor.position.set(0, -middle, 0);
  }

  /** The view's drift, in degrees: the shelf turned about the stage's middle, as `projectToStage`
   *  turns it for the callouts. */
  setView(yaw: number, pitch: number) {
    this.pivot.rotation.set(rad(SHELF.look + pitch), rad(yaw), 0);
  }

  setTheme(dark: boolean, background: string) {
    this.scene.background = new THREE.Color(background);
    this.paper.value.set(background);
    if (dark) {
      this.plankTop.color.set(0x48484c);
      this.plankEdge.color.set(0x2a2a2d);
      this.plankTone.from.value = 0.2;
      this.plankTone.to.value = 1.5;
      this.plankTone.lo.value.set(0, 0, 0);
      this.plankTone.hi.value.set(0.44, 0.44, 0.455);
      this.rim.color.set(0x77777c);
      this.backdropTone.value.set(0x55555a);
    } else {
      this.plankTop.color.set(0xffffff);
      this.plankEdge.color.set(0xc4c4c9);
      this.plankTone.from.value = 0.5;
      this.plankTone.to.value = 0.99;
      this.plankTone.lo.value.set(0.17, 0.17, 0.185);
      this.plankTone.hi.value.set(1, 1, 1);
      this.rim.color.set(0x1c1c1e);
      this.backdropTone.value.set(0xb4b4b9);
    }
  }

  /** The books on the shelf, in order. One is rebuilt only when what it is made of changed. */
  setBooks(specs: readonly ShelfBookSpec[]) {
    const kept = new Map(this.books.map((b) => [b.spec.key, b]));
    this.books = specs.map((spec) => {
      const signature = [spec.title, spec.number, spec.cover.form, spec.cover.binding, spec.width, spec.height, spec.depth, spec.board, spec.ink].join('|');
      const had = kept.get(spec.key);
      kept.delete(spec.key);
      if (had && had.signature === signature) return had;
      if (had) this.discard(had.group);
      const built = this.build(spec);
      this.floor.add(built.group);
      return { spec, signature, ...built };
    });
    for (const gone of kept.values()) this.discard(gone.group);
    for (const b of this.books) this.wear(b);
  }

  /** A book's cover picture, once it has loaded; `aspect` is the picture's own shape. */
  setCover(key: string, texture: THREE.Texture, aspect: number) {
    this.covers.get(key)?.texture.dispose();
    this.covers.set(key, { texture, aspect });
    const book = this.books.find((b) => b.spec.key === key);
    if (book) this.wear(book);
  }

  private wear(book: (typeof this.books)[number]) {
    const cover = this.covers.get(book.spec.key);
    if (!cover || !book.coverMaterial) return;
    const { width, height, cover: kind } = book.spec;
    const border = kind.form === 'sheets' ? PRINT.border * width : 0;
    // Cropped to the face about its middle, never stretched to it.
    const face = (width - 2 * border) / (height - 2 * border);
    const across = Math.min(1, face / cover.aspect);
    const up = Math.min(1, cover.aspect / face);
    const { texture } = cover;
    if (kind.form === 'scroll') {
      // An extruded face's texture coordinates are its own points, from its middle.
      texture.repeat.set(across / width, up / height);
      texture.offset.set(0.5, 0.5);
    } else {
      texture.repeat.set(across, up);
      texture.offset.set((1 - across) / 2, (1 - up) / 2);
    }
    book.coverMaterial.map = texture;
    book.coverMaterial.color.set(0xffffff);
    book.coverMaterial.needsUpdate = true;
    if (book.behind) {
      // The set's own picture again, dimmed, as the card draws the print behind.
      book.behind.map = texture;
      book.behind.color.set(0xb4b4b4);
      book.behind.needsUpdate = true;
    }
  }

  private build(spec: ShelfBookSpec): Built {
    const { width: w, height: h, depth: d } = spec;
    const { form, binding } = spec.cover;
    const group = new THREE.Group();
    const side = binding === 'left' ? -1 : 1;
    const hinge = (side * w) / 2;
    const half = d / 2;
    const board = this.matte({ color: colour(spec.board), roughness: 0.62 });
    // Its cloth's colour until its picture arrives.
    const coverMaterial = this.glossy({ color: colour(spec.board) });
    let behind: Built['behind'] = null;

    if (form === 'scroll') {
      // Nothing bound: a slab with rounded corners and a bevelled rim.
      const r = 5;
      const bevel = Math.min(0.9, d * 0.3);
      const shape = new THREE.Shape();
      shape.moveTo(-w / 2 + r, -h / 2);
      shape.lineTo(w / 2 - r, -h / 2);
      shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
      shape.lineTo(w / 2, h / 2 - r);
      shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
      shape.lineTo(-w / 2 + r, h / 2);
      shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
      shape.lineTo(-w / 2, -h / 2 + r);
      shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
      const slab = new THREE.ExtrudeGeometry(shape, {
        depth: Math.max(0.2, d - 2 * bevel),
        bevelEnabled: true,
        bevelThickness: bevel,
        bevelSize: bevel,
        bevelSegments: 2,
        curveSegments: 6,
      });
      slab.translate(0, h / 2, -half + bevel);
      const mesh = new THREE.Mesh(slab, [coverMaterial, board]);
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    } else if (form === 'sheets') {
      // The card's own picture of a CG set (`PRINT` in lib/book-cover): a print in a white paper
      // border with another tipped behind it. Here they are two cards with the book's depth between
      // them, each leaning its own way on a corner, so the set is two loose pictures from any side
      // and never a thin book.
      const border = PRINT.border * w;
      const card = 0.9;
      behind = this.glossy({ color: colour(spec.board), roughness: 0.8 });
      coverMaterial.roughness = 0.8;
      // Each turned about its own middle and stood on whichever corner is then lowest.
      const print = (z: number, material: THREE.Material, lean: number, along: number) => {
        const turn = rad(lean);
        const paper = new THREE.Mesh(new THREE.BoxGeometry(w, h, card), this.shared.print);
        const picture = new THREE.Mesh(new THREE.PlaneGeometry(w - 2 * border, h - 2 * border).translate(0, 0, card / 2 + 0.05), material);
        paper.castShadow = paper.receiveShadow = picture.receiveShadow = true;
        const sheet = new THREE.Group();
        sheet.position.set(along, (h / 2) * Math.cos(turn) + (w / 2) * Math.abs(Math.sin(turn)), z);
        sheet.rotation.z = turn;
        sheet.add(paper, picture);
        group.add(sheet);
      };
      print(half - card / 2, coverMaterial, -side * PRINT_LEAN.front, 0);
      print(-half + card / 2, behind, -side * PRINT_LEAN.behind, side * w * PRINT_LEAN.aside);
    } else {
      const hard = form === 'volume';
      const thick = hard ? 1.6 : 0.5;
      const overhang = hard ? 2.4 : 0;
      this.emboss(coverMaterial, form, binding, w / h);
      const cloth: THREE.BufferGeometry[] = [new THREE.BoxGeometry(w, h, thick).translate(0, h / 2, -half + thick / 2)];
      // The front board's picture is a sheet of its own just proud of it, which leaves the board
      // itself all cloth. Both are cut to a cover's own outline — its two free corners rounded,
      // the bound ones square — and the board's edge is rolled over, where the picture stops short
      // of it: a rectangle with a razor's edge was a picture pasted on a box, and the line of
      // light along a rolled edge is most of what says the cover has a thickness.
      const toward = -side;
      const corner = hard ? 3 : 2;
      const roll = hard ? 0.5 : 0.2;
      const outline = new THREE.Shape();
      outline.moveTo(0, 0);
      outline.lineTo(toward * (w - corner), 0);
      outline.quadraticCurveTo(toward * w, 0, toward * w, corner);
      outline.lineTo(toward * w, h - corner);
      outline.quadraticCurveTo(toward * w, h, toward * (w - corner), h);
      outline.lineTo(0, h);
      outline.closePath();
      const slab = new THREE.ExtrudeGeometry(outline, {
        depth: thick - 2 * roll,
        bevelEnabled: true,
        bevelThickness: roll,
        bevelSize: roll,
        // The roll comes out of the board's own size, not on top of it.
        bevelOffset: -roll,
        bevelSegments: 3,
        curveSegments: 6,
      }).translate(hinge, 0, half - thick + roll);
      const sheet = new THREE.ShapeGeometry(outline, 6);
      // A shape's own texture coordinates are its points; the picture wants the face's, from its
      // left edge and its foot, whichever side it is bound on.
      const at = sheet.attributes.position;
      for (let n = 0; n < at.count; n++) sheet.attributes.uv.setXY(n, toward > 0 ? at.getX(n) / w : at.getX(n) / w + 1, at.getY(n) / h);
      sheet.scale((w - roll) / w, (h - 2 * roll) / h, 1).translate(hinge, roll, half + 0.05);
      const face = new THREE.Mesh(sheet, coverMaterial);
      face.receiveShadow = true;
      group.add(face);
      cloth.push(slab);

      // The page block, set back from the boards on three sides. It alone casts the book's shadow:
      // the boards are a hair larger and would only cast the same one again.
      const blockDepth = Math.max(0.3, d - 2 * thick - 0.3);
      const pages = new THREE.Mesh(
        new THREE.BoxGeometry(w - overhang, h - 2 * overhang, blockDepth).translate((side * overhang) / 2, h / 2, 0),
        this.shared.block,
      );
      pages.castShadow = pages.receiveShadow = true;
      group.add(pages);

      if (hard) {
        // A rounded back: half an ellipse from board to board, lettered down its length.
        const bulge = THREE.MathUtils.clamp(d * 0.24, 2, 6);
        const segments = 14;
        const positions: number[] = [];
        const normals: number[] = [];
        const uvs: number[] = [];
        const index: number[] = [];
        const outline: THREE.Vector2[] = [];
        for (let j = 0; j <= segments; j++) {
          const f = -Math.PI / 2 + (Math.PI * j) / segments;
          const x = hinge + side * bulge * Math.cos(f);
          const z = -half * Math.sin(f);
          const nx = (side * Math.cos(f)) / bulge;
          const nz = -Math.sin(f) / half;
          const nl = Math.hypot(nx, nz);
          const u = side < 0 ? 1 - j / segments : j / segments;
          positions.push(x, 0, z, x, h, z);
          normals.push(nx / nl, 0, nz / nl, nx / nl, 0, nz / nl);
          uvs.push(u, 0, u, 1);
          outline.push(new THREE.Vector2(x, -z));
          if (j < segments) index.push(j * 2, j * 2 + 1, j * 2 + 2, j * 2 + 1, j * 2 + 3, j * 2 + 2);
        }
        const hull = new THREE.BufferGeometry();
        hull.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        hull.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        hull.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        hull.setIndex(index);
        const lettering = this.drawSpine({
          title: spec.title,
          number: spec.number,
          board: spec.board,
          ink: spec.ink,
          width: Math.PI * Math.sqrt((bulge * bulge + half * half) / 2),
          height: h,
        });
        const back = this.glossy(lettering ? { map: lettering } : { color: colour(spec.board) });
        back.outputNode = this.inkedSpine;
        back.side = THREE.DoubleSide;
        const spine = new THREE.Mesh(hull, back);
        spine.userData.cloth = colour(spec.board);
        spine.userData.letter = colour(spec.ink);
        spine.receiveShadow = true;
        group.add(spine);
        cloth.push(new THREE.ShapeGeometry(new THREE.Shape(outline)).rotateX(-Math.PI / 2).translate(0, h - 0.5, 0));
      } else {
        const wire = h * 0.07;
        group.add(
          new THREE.Mesh(
            merged([0.205, 0.725].map((at) => new THREE.CylinderGeometry(0.6, 0.6, wire, 6).translate(hinge + side * 0.25, h * (1 - at) - wire / 2, 0))),
            this.shared.staple,
          ),
        );
      }
      const boards = new THREE.Mesh(merged(cloth), board);
      boards.receiveShadow = true;
      group.add(boards);
    }

    return { group, coverMaterial, behind };
  }

  /**
   * The cover's relief, as the card draws it flat (`SPINE`, `FOLD` and `EDGES` in lib/book-cover):
   * the board rolling away at the binding, the groove of the hinge and its lip, a catch of light
   * on the fore-edge and the head, the foot turning away. Laid over the picture in the material,
   * where the light then falls across it too. And its wear: the laminate rubbed through to paper
   * along the free edges and most at the two free corners, where a book is handled, in a grain so
   * it is not a drawn line. `shape` is the cover's width over its height.
   */
  private emboss(material: THREE.MeshStandardNodeMaterial, form: BookCover['form'], binding: BookCover['binding'], shape: number) {
    material.colorNode = Fn(() => {
      const at = uv() as unknown as THREE.Node<'vec2'>;
      const fromBinding = binding === 'left' ? at.x : at.x.oneMinus();
      const band = (from: number, peak: number, to: number) => smoothstep(from, peak, fromBinding).mul(smoothstep(peak, to, fromBinding).oneMinus());
      const [shade, light] =
        form === 'volume'
          ? [
              smoothstep(0.011, 0, fromBinding).mul(0.36).add(band(0.026, 0.037, 0.048).mul(0.2)),
              band(0.011, 0.014, 0.023).mul(0.16).add(band(0.048, 0.054, 0.065).mul(0.09)),
            ]
          : [band(0.006, 0.011, 0.042).mul(0.3), smoothstep(0.0085, 0, fromBinding).mul(0.3)];
      const dark = shade.add(smoothstep(0.02, 0, at.y).mul(0.28));
      const lit = light.add(smoothstep(0.988, 1, fromBinding).mul(0.08)).add(smoothstep(0.986, 1, at.y).mul(0.13));
      const picture = materialColor as unknown as THREE.Node<'vec4'>;
      const fromFree = fromBinding.oneMinus();
      // Distances in cover widths, so the wear is as wide down the fore-edge as along head and foot.
      const up = at.y.div(shape);
      const down = at.y.oneMinus().div(shape);
      const edge = min(fromFree, min(up, down));
      const corner = fromFree.add(min(up, down));
      const grain = fract(sin(dot(at.mul(vec2(311.7, 183.3)), vec2(12.9898, 78.233))).mul(43758.5453));
      const rubbed = clamp(
        smoothstep(0.002, 0.012, edge).oneMinus().mul(grain.mul(0.7).add(0.3)).add(smoothstep(0.008, 0.035, corner).oneMinus().mul(grain.mul(0.5).add(0.5))),
        0,
        1,
      );
      const printed = vec3Of(picture.xyz.mul(dark.oneMinus()).add(lit));
      return vec4(mix(printed, vec3(0.93, 0.91, 0.86), rubbed.mul(0.55)), picture.w);
    })();
  }

  private discard(group: THREE.Group) {
    this.floor.remove(group);
    const shared = new Set<THREE.Material>(Object.values(this.shared));
    // A cover's picture outlives its book (`covers`).
    const kept = new Set<THREE.Texture>([...this.covers.values()].map((c) => c.texture));
    group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.geometry.dispose();
      for (const material of [o.material].flat() as THREE.MeshStandardNodeMaterial[]) {
        if (shared.has(material)) continue;
        if (material.map && !kept.has(material.map)) material.map.dispose();
        material.dispose();
      }
    });
  }

  /** Draws the shelf with each book at its place; `ink` off leaves every book in colour. */
  render(places: readonly ShelfPlace[], ink: boolean) {
    let stand = '';
    this.books.forEach(({ group }, i) => {
      const place = places[i];
      if (!place) return;
      group.position.set(place.x, 0, place.z);
      group.rotation.y = rad(place.yaw);
      stand += `;${place.x.toFixed(1)},${place.z.toFixed(1)},${place.yaw.toFixed(1)}`;
      const tone = ink ? place.ink : 0;
      group.traverse((o) => {
        o.userData.ink = tone;
      });
    });
    if (stand !== this.cast) {
      this.cast = stand;
      this.key.shadow.needsUpdate = true;
    }
    this.renderer.render(this.scene, this.camera);
    this.present();
  }

  /** The book under a point of the stage, or -1. */
  pick(x: number, y: number): number {
    const { width, height } = this.size;
    this.ray.setFromCamera(new THREE.Vector2((x / width) * 2 - 1, -(y / height) * 2 + 1), this.camera);
    const hit = this.ray.intersectObjects(
      this.books.map((b) => b.group),
      true,
    )[0];
    for (let o: THREE.Object3D | null = hit?.object ?? null; o; o = o.parent) {
      const found = this.books.findIndex((b) => b.group === o);
      if (found >= 0) return found;
    }
    return -1;
  }

  dispose() {
    for (const b of this.books) this.discard(b.group);
    this.books = [];
    for (const cover of this.covers.values()) cover.texture.dispose();
    this.covers.clear();
  }
}
