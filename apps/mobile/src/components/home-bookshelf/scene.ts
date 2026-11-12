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
  floor,
  length,
  mix,
  mod,
  output,
  sRGBTransferEOTF,
  sRGBTransferOETF,
  screenCoordinate,
  screenUV,
  smoothstep,
  step,
  uniform,
  userData,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import * as THREE from 'three/webgpu';

import { SHELF, cssRgb, type Rgb, type ShelfPlace } from '@/lib/bookshelf';
import type { BookCover } from '@/lib/book-cover';

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
  private readonly shared: { paper: THREE.Material; staple: THREE.Material; linesAcross: THREE.DataTexture; linesUp: THREE.DataTexture };
  private readonly inkedBook: ReturnType<ShelfScene['inked']>;
  private readonly ray = new THREE.Raycaster();
  private books: { spec: ShelfBookSpec; signature: string; group: THREE.Group; coverMaterial: THREE.MeshStandardNodeMaterial | null }[] = [];
  private covers = new Map<string, { texture: THREE.Texture; aspect: number }>();
  private size = { width: 1, height: 1 };

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
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.bias = -0.0006;
    this.key.shadow.normalBias = 0.6;
    Object.assign(this.key.shadow.camera, { left: -380, right: 380, top: 380, bottom: -380, near: 100, far: 2400 });
    this.key.position.set(-250, 620, 560);
    this.key.target.position.set(0, 100, 0);
    this.scene.add(this.key, this.key.target);

    this.inkedBook = this.inked(userData('ink', 'float') as unknown as THREE.Node<'float'>, this.bookTone);
    const lines = (across: boolean) => {
      // Cut paper seen edge on: sheets a hair apart, no two the same grey.
      const cells = 64;
      const data = new Uint8Array(cells * 4);
      let seed = across ? 7 : 8;
      for (let i = 0; i < cells; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const dark = i % 2 ? 0.12 + (seed / 4294967296) * 0.22 : 0;
        data.set([241 - dark * 171, 235 - dark * 183, 221 - dark * 197, 255], i * 4);
      }
      const texture = new THREE.DataTexture(data, across ? cells : 1, across ? 1 : cells);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.needsUpdate = true;
      return texture;
    };
    this.shared = {
      paper: this.matte({ color: new THREE.Color(PAPER) }),
      staple: new THREE.MeshStandardNodeMaterial({ color: 0xd8dde4, metalness: 1, roughness: 0.3 }),
      linesAcross: lines(true),
      linesUp: lines(false),
    };

    // The shelf is always ink: its light is the page and the shadows the books cast on it are tone.
    this.plankTop = new THREE.MeshStandardNodeMaterial({ roughness: 1 });
    this.plankTop.outputNode = this.inked(float(1), this.plankTone);
    const edgeTone = { ...this.plankTone, from: uniform(0), to: uniform(1) };
    this.plankEdge = new THREE.MeshStandardNodeMaterial({ roughness: 1 });
    this.plankEdge.outputNode = this.inked(float(1), edgeTone);
    const plank = new THREE.Mesh(new THREE.BoxGeometry(3000, 12, 240), [
      this.plankEdge,
      this.plankEdge,
      this.plankTop,
      this.plankEdge,
      this.plankEdge,
      this.plankEdge,
    ]);
    plank.position.set(0, -6, -40);
    plank.receiveShadow = true;
    const rim = new THREE.Mesh(new THREE.BoxGeometry(3000, 1.6, 1.6), this.rim);
    rim.position.set(0, -0.8, 80.4);
    this.floor.add(plank, rim);

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

  /** The stage's size in points. The camera is `projectToStage`'s: the eye `lens` back and level
   *  with 44% down the stage, which `setViewOffset` takes as a window on a taller, centred view. */
  resize(width: number, height: number, pixelRatio: number) {
    if (!width || !height) return;
    this.size = { width, height };
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.dot.value = Math.max(1, Math.floor(DOT_POINTS * pixelRatio + 0.25));
    const { camera } = this;
    camera.fov = (2 * Math.atan((0.56 * height) / SHELF.lens) * 180) / Math.PI;
    camera.aspect = width / (1.12 * height);
    camera.position.set(0, 0.56 * height - SHELF.floor, SHELF.lens);
    camera.setViewOffset(width, 1.12 * height, 0, 0.12 * height, width, height);
    const middle = height / 2 - SHELF.floor;
    this.pivot.position.set(0, middle, 0);
    this.pivot.rotation.set(rad(SHELF.look), 0, 0);
    this.floor.position.set(0, -middle, 0);
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
    // Cropped to the face about its middle, never stretched to it.
    const face = width / height;
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
  }

  private build(spec: ShelfBookSpec): { group: THREE.Group; coverMaterial: THREE.MeshStandardNodeMaterial | null } {
    const { width: w, height: h, depth: d } = spec;
    const { form, binding } = spec.cover;
    const group = new THREE.Group();
    const side = binding === 'left' ? -1 : 1;
    const hinge = (side * w) / 2;
    const half = d / 2;
    const board = this.matte({ color: colour(spec.board), roughness: 0.62 });
    // Its cloth's colour until its picture arrives.
    const coverMaterial = this.glossy({ color: colour(spec.board) });
    const { paper } = this.shared;

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
      group.add(new THREE.Mesh(slab, [coverMaterial, board]));
    } else if (form === 'sheets') {
      // Loose prints, each with a little curl of its own.
      coverMaterial.side = THREE.DoubleSide;
      coverMaterial.roughness = 0.8;
      [
        [0, 0.03],
        [3.5, 0.055],
        [-3, 0.015],
      ].forEach(([lean, curl], i) => {
        const sheet = new THREE.PlaneGeometry(w, h, 10, 1);
        const at = sheet.attributes.position;
        for (let n = 0; n < at.count; n++) at.setZ(n, -curl * w * (at.getX(n) / w) ** 2 * 4);
        sheet.computeVertexNormals();
        const mesh = new THREE.Mesh(sheet, i === 0 ? coverMaterial : paper);
        mesh.position.set(0, h / 2 + (i ? 4 : 0), 3 - i * 3);
        mesh.rotation.z = rad(lean);
        group.add(mesh);
      });
    } else {
      const hard = form === 'volume';
      const thick = hard ? 1.6 : 0.5;
      const overhang = hard ? 2.4 : 0;
      const back = new THREE.Mesh(new THREE.BoxGeometry(w, h, thick), board);
      back.position.set(0, h / 2, -half + thick / 2);
      const front = new THREE.Mesh(new THREE.BoxGeometry(w, h, thick), [board, board, board, board, coverMaterial, board]);
      front.position.set(0, h / 2, half - thick / 2);
      group.add(back, front);

      // The page block, set back from the boards on three sides.
      const blockDepth = Math.max(0.3, d - 2 * thick - 0.3);
      const sheets = Math.max(0.05, blockDepth / 1.6 / 32);
      const edge = (across: boolean) => {
        const map = (across ? this.shared.linesAcross : this.shared.linesUp).clone();
        if (across) map.repeat.set(sheets, 1);
        else map.repeat.set(1, sheets);
        return this.matte({ map });
      };
      const fore = edge(true);
      const ends = edge(false);
      const block = new THREE.Mesh(
        new THREE.BoxGeometry(w - overhang, h - 2 * overhang, blockDepth),
        side < 0 ? [fore, paper, ends, ends, paper, paper] : [paper, fore, ends, ends, paper, paper],
      );
      block.position.set((side * overhang) / 2, h / 2, 0);
      group.add(block);

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
        const spine = this.glossy(lettering ? { map: lettering } : { color: colour(spec.board) });
        spine.side = THREE.DoubleSide;
        group.add(new THREE.Mesh(hull, spine));
        const cap = this.matte({ color: colour(spec.board).multiplyScalar(0.55), side: THREE.DoubleSide });
        for (const y of [0.5, h - 0.5]) {
          const lid = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(outline)).rotateX(-Math.PI / 2), cap);
          lid.position.y = y;
          group.add(lid);
        }
      } else {
        for (const at of [0.205, 0.725]) {
          const length = h * 0.07;
          const staple = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, length, 6), this.shared.staple);
          staple.position.set(hinge + side * 0.25, h * (1 - at) - length / 2, 0);
          group.add(staple);
        }
      }
    }

    group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
    });
    return { group, coverMaterial };
  }

  private discard(group: THREE.Group) {
    this.floor.remove(group);
    const { paper, staple, linesAcross, linesUp } = this.shared;
    // A cover's picture outlives its book (`covers`), and the page lines are every book's.
    const kept = new Set<THREE.Texture>([linesAcross, linesUp, ...[...this.covers.values()].map((c) => c.texture)]);
    group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.geometry.dispose();
      for (const material of [o.material].flat() as THREE.MeshStandardNodeMaterial[]) {
        if (material === paper || material === staple) continue;
        if (material.map && !kept.has(material.map)) material.map.dispose();
        material.dispose();
      }
    });
  }

  /** Draws the shelf with each book at its place; `ink` off leaves every book in colour. */
  render(places: readonly ShelfPlace[], ink: boolean) {
    this.books.forEach(({ group }, i) => {
      const place = places[i];
      if (!place) return;
      group.position.set(place.x, 0, place.z);
      group.rotation.y = rad(place.yaw);
      const tone = ink ? place.ink : 0;
      group.traverse((o) => {
        o.userData.ink = tone;
      });
    });
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
    this.shared.linesAcross.dispose();
    this.shared.linesUp.dispose();
  }
}
