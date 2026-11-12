/**
 * The shelf's shaders, in WGSL: what `scene.ts` has three write from its node materials, written
 * out by hand. One light with a shadow, the sky's fill, and the lit colour cut to the app's
 * screentone — the same sums in the same order, so the two renderers draw the same shelf.
 */
import { MATERIAL } from './geometry';

/** The most books a shelf draws: a slot each in one uniform block, and one more for the plank. */
export const MAX_BOOKS = 48;
export const BOOK_FLOATS = 24;
export const FRAME_FLOATS = 116;
export const SHADOW_SIZE = 1024;

/** A colour as the shader works in it: linear light, from the 0–255 a screen is given. */
export const linear = (channel: number) => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const hex = (colour: string) => {
  const value = parseInt(colour.slice(1), 16);
  return `vec3f(${[value >> 16, (value >> 8) & 255, value & 255].map((c) => linear(c).toFixed(6)).join(', ')})`;
};

const M = MATERIAL;

export const SHADER = /* wgsl */ `
struct Tone {
  lo: vec4f,     // the ink, as shown on screen; w is how many steps the tone is cut to
  hi: vec4f,     // the paper
  range: vec4f,  // the brightness the ink and the paper stand for
}

struct Frame {
  viewProjection: mat4x4f,
  shelf: mat4x4f,
  sunProjection: mat4x4f,
  eye: vec4f,       // w is one cell of the dither, in pixels
  sun: vec4f,       // toward the light; w is one cell of the backdrop's dither
  paper: vec4f,
  backdrop: vec4f,
  plank: vec4f,
  plankFront: vec4f,
  rim: vec4f,
  size: vec4f,
  bookTone: Tone,
  plankTone: Tone,
  frontTone: Tone,
}

struct Book {
  place: vec4f,   // x, z, its turn in radians, how much of it is tone
  board: vec4f,   // w is 1 once its cover has a picture
  cloth: vec4f,
  letter: vec4f,  // w is the cover's width over its height
  crop: vec4f,    // the picture cropped to the face: scale, then offset
  kind: vec4f,    // x: 0 a hard cover, 1 a soft one, 2 loose prints, 3 a slab; y: 1 bound on its left
}

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<uniform> books: array<Book, ${MAX_BOOKS}>;
@group(0) @binding(2) var shadowMap: texture_depth_2d;
@group(0) @binding(3) var shadowSampler: sampler_comparison;
@group(0) @binding(4) var pictureSampler: sampler;
@group(1) @binding(0) var coverPicture: texture_2d<f32>;
@group(1) @binding(1) var spinePicture: texture_2d<f32>;

const PI = 3.141592653589793;
const LUMA = vec3f(0.2126, 0.7152, 0.0722);
const SUN_LIGHT = 2.6;
const SKY_LIGHT = 1.7;
const GROUND = ${hex('#9a948a')};
const PAPER = ${hex('#F1EBDD')};
const PAPER_CUT = ${hex('#CFC4AA')};
const PRINT = ${hex('#FBFAF7')};
const STAPLE = ${hex('#d8dde4')};
const BEHIND = ${linear(0xb4).toFixed(6)};
const LETTER_GRAIN = 0.5;
const RUBBED = vec3f(0.93, 0.91, 0.86);
const RUB = 0.55;
const SHADOW_BIAS = -0.0006;
const NORMAL_BIAS = 0.6;

struct Vertex {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) material: f32,
}

struct Varyings {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) local: vec3f,
  @location(4) shadow: vec3f,
  @location(5) @interpolate(flat) material: u32,
  @location(6) @interpolate(flat) book: u32,
}

fn turned(v: vec3f, yaw: f32) -> vec3f {
  let c = cos(yaw);
  let s = sin(yaw);
  return vec3f(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
}

fn stood(position: vec3f, index: u32) -> vec4f {
  let place = books[index].place;
  return frame.shelf * vec4f(turned(position, place.z) + vec3f(place.x, 0.0, place.y), 1.0);
}

@vertex
fn shadowVertex(@location(0) position: vec3f, @builtin(instance_index) index: u32) -> @builtin(position) vec4f {
  return frame.sunProjection * stood(position, index);
}

@vertex
fn vertex(in: Vertex, @builtin(instance_index) index: u32) -> Varyings {
  var out: Varyings;
  let world = stood(in.position, index);
  let normal = normalize((frame.shelf * vec4f(turned(in.normal, books[index].place.z), 0.0)).xyz);
  out.clip = frame.viewProjection * world;
  out.world = world.xyz;
  out.normal = normal;
  out.uv = in.uv;
  out.local = in.position;
  let lit = frame.sunProjection * vec4f(world.xyz + normal * NORMAL_BIAS, 1.0);
  out.shadow = vec3f(lit.xy * vec2f(0.5, -0.5) + 0.5, lit.z);
  out.material = u32(in.material + 0.5);
  out.book = index;
  return out;
}

// The screen's transfer curve and its inverse, as three writes them.
fn encode(c: vec3f) -> vec3f {
  let high = pow(max(c, vec3f(0.0)), vec3f(0.41666)) * 1.055 - 0.055;
  return select(high, c * 12.92, c <= vec3f(0.0031308));
}

fn decode(c: vec3f) -> vec3f {
  let high = pow(c * 0.9478672986 + 0.0521327014, vec3f(2.4));
  return select(high, c * 0.0773993808, c <= vec3f(0.04045));
}

fn wrapped(x: f32, by: f32) -> f32 {
  return x - by * floor(x / by);
}

// The 4x4 Bayer threshold of a cell: the page curl's matrix.
fn bayer(cell: vec2f) -> f32 {
  let q = vec2f(wrapped(cell.x, 4.0), wrapped(cell.y, 4.0));
  let x0 = wrapped(q.x, 2.0);
  let y0 = wrapped(q.y, 2.0);
  let x1 = floor(q.x / 2.0);
  let y1 = floor(q.y / 2.0);
  return (wrapped(x0 + y0, 2.0) * 8.0 + y0 * 4.0 + wrapped(x1 + y1, 2.0) * 2.0 + y1) / 16.0 + 1.0 / 32.0;
}

fn stepped(light: f32, levels: f32, cell: vec2f) -> f32 {
  return clamp(floor(light * levels + bayer(cell)) / levels, 0.0, 1.0);
}

fn ranged(shown: f32, tone: Tone) -> f32 {
  return clamp((shown - tone.range.x) / (tone.range.y - tone.range.x), 0.0, 1.0);
}

// A lit colour drawn as tone: its brightness as shown on screen, cut to the tone's steps by an
// ordered dither between an ink and a paper, and laid over the colour by 'ink'.
fn inked(lit: vec3f, ink: f32, tone: Tone, cell: vec2f) -> vec3f {
  let light = ranged(dot(encode(lit), LUMA), tone);
  let cut = stepped(light, tone.lo.w, cell);
  return mix(lit, decode(mix(tone.lo.rgb, tone.hi.rgb, cut)), ink);
}

// A spine's tone: its cloth cut to the covers' steps, its lettering half that and half solid.
fn lettered(lit: vec3f, surface: vec3f, cloth: vec3f, letter: vec3f, ink: f32, tone: Tone, cell: vec2f) -> vec3f {
  let across = letter - cloth;
  let lettering = clamp(dot(surface - cloth, across) / max(dot(across, across), 0.0001), 0.0, 1.0);
  // The light that fell here as a share of the surface's own colour, which is what the cloth alone
  // would have shown: the cloth's tone must not change under a letter.
  let fell = dot(lit, LUMA) / max(dot(surface, LUMA), 0.02);
  let bare = clamp(fell * dot(cloth, LUMA), 0.0, 1.0);
  let light = ranged(encode(vec3f(bare)).x, tone);
  let toned = stepped(light, tone.lo.w, cell);
  let grained = stepped(ranged(dot(encode(lit), LUMA), tone), tone.lo.w, cell);
  let cut = mix(toned, mix(step(light, 0.5), grained, LETTER_GRAIN), lettering);
  return mix(lit, decode(mix(tone.lo.rgb, tone.hi.rgb, cut)), ink);
}

fn grained(at: vec2f) -> f32 {
  return fract(sin(dot(at * vec2f(311.7, 183.3), vec2f(12.9898, 78.233))) * 43758.5453);
}

// How far an edge is rubbed through, 'edge' cover widths in from it.
fn rubbedEdge(edge: f32, grain: f32) -> f32 {
  return (1.0 - smoothstep(0.002, 0.012, edge)) * (grain * 0.7 + 0.3);
}

fn band(low: f32, peak: f32, high: f32, x: f32) -> f32 {
  return smoothstep(low, peak, x) * (1.0 - smoothstep(peak, high, x));
}

fn fall(to: f32, x: f32) -> f32 {
  return 1.0 - smoothstep(0.0, to, x);
}

// A bound cover's relief and its wear, laid over its picture ('emboss' in the other scene).
fn embossed(picture: vec3f, at: vec2f, hard: bool, left: bool, shape: f32) -> vec3f {
  let fromBinding = select(1.0 - at.x, at.x, left);
  var shade = band(0.006, 0.011, 0.042, fromBinding) * 0.3;
  var light = fall(0.0085, fromBinding) * 0.3;
  if (hard) {
    shade = fall(0.011, fromBinding) * 0.36 + band(0.026, 0.037, 0.048, fromBinding) * 0.2;
    light = band(0.011, 0.014, 0.023, fromBinding) * 0.16 + band(0.048, 0.054, 0.065, fromBinding) * 0.09;
  }
  let dark = shade + fall(0.02, at.y) * 0.28;
  let caught = light + smoothstep(0.988, 1.0, fromBinding) * 0.08 + smoothstep(0.986, 1.0, at.y) * 0.13;
  let fromFree = 1.0 - fromBinding;
  // Distances in cover widths, so the wear is as wide down the fore-edge as along head and foot.
  let up = at.y / shape;
  let down = (1.0 - at.y) / shape;
  let edge = min(fromFree, min(up, down));
  let corner = fromFree + min(up, down);
  let grain = grained(at);
  let rubbed = clamp(rubbedEdge(edge, grain) + (1.0 - smoothstep(0.008, 0.035, corner)) * (grain * 0.5 + 0.5), 0.0, 1.0);
  let printed = picture * (1.0 - dark) + caught;
  return mix(printed, RUBBED, rubbed * RUB);
}

// The cover's wear carried on round the back: the same rub along the spine's head and foot.
fn rubbedEnds(cloth: vec3f, at: vec2f, shape: f32) -> vec3f {
  let ends = min(at.y, 1.0 - at.y) / shape;
  return mix(cloth, RUBBED, rubbedEdge(ends, grained(at)) * RUB);
}

// How much of the key light reaches a point: the shadow map read at nine places round it.
fn sunlit(at: vec3f) -> f32 {
  if (at.x < 0.0 || at.x > 1.0 || at.y < 0.0 || at.y > 1.0 || at.z > 1.0) {
    return 1.0;
  }
  var sum = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      sum += textureSampleCompareLevel(shadowMap, shadowSampler, at.xy + vec2f(f32(x), f32(y)) / ${SHADOW_SIZE}.0, at.z + SHADOW_BIAS);
    }
  }
  return sum / 9.0;
}

// The key light and the sky's fill on a surface, as three's standard material sums them.
fn shaded(albedo: vec3f, roughness: f32, metal: f32, n: vec3f, v: vec3f, sun: f32) -> vec3f {
  let rough = max(roughness, 0.0525);
  let alpha = rough * rough;
  let a2 = alpha * alpha;
  let diffuse = albedo * (1.0 - metal);
  let f0 = mix(vec3f(0.04), albedo, metal);
  let l = frame.sun.xyz;
  let h = normalize(l + v);
  let nl = clamp(dot(n, l), 0.0, 1.0);
  let nv = clamp(dot(n, v), 0.0, 1.0);
  let nh = clamp(dot(n, h), 0.0, 1.0);
  let vh = clamp(dot(v, h), 0.0, 1.0);

  let glance = exp2((-5.55473 * vh - 6.98316) * vh);
  let fresnel = f0 * (1.0 - glance) + glance;
  let spread = nh * nh * (a2 - 1.0) + 1.0;
  let facets = a2 / (PI * spread * spread);
  let masked = 0.5 / max(nl * sqrt(a2 + (1.0 - a2) * nv * nv) + nv * sqrt(a2 + (1.0 - a2) * nl * nl), 0.000001);

  // What the gloss takes of the light before the colour under it sees any.
  let r = rough * vec4f(-1.0, -0.0275, -0.572, 0.022) + vec4f(1.0, 0.0425, 1.04, -0.04);
  let a004 = min(r.x * r.x, exp2(-9.28 * nv)) * r.x + r.y;
  let fab = vec2f(-1.04, 1.04) * a004 + r.zw;
  let single = vec3f(0.04) * fab.x + fab.y;
  let lost = 1.0 - (fab.x + fab.y);
  let average = 0.04 + (1.0 - 0.04) * 0.047619;
  let multiple = single * average / (1.0 - lost * average) * lost;
  let compensation = 1.0 + f0 * (1.0 / max(fab.x + fab.y, 0.001) - 1.0);

  let direct = nl * SUN_LIGHT * sun;
  let sky = mix(GROUND, vec3f(1.0), n.y * 0.5 + 0.5) * SKY_LIGHT;
  return direct * (diffuse / PI * (1.0 - fresnel) + fresnel * facets * masked * compensation) + sky * diffuse / PI * (1.0 - single - multiple);
}

@fragment
fn fragment(in: Varyings) -> @location(0) vec4f {
  let book = books[in.book];
  let cell = floor(in.clip.xy / frame.eye.w);
  // The pictures first: a picture is read at every pixel of a face or at none.
  let coverAt = vec2f(in.uv.x * book.crop.x + book.crop.z, 1.0 - (in.uv.y * book.crop.y + book.crop.w));
  let cover = textureSample(coverPicture, pictureSampler, coverAt).rgb;
  let spine = textureSample(spinePicture, pictureSampler, vec2f(in.uv.x, 1.0 - in.uv.y)).rgb;
  let sun = sunlit(in.shadow);
  let n = normalize(in.normal);
  let v = normalize(frame.eye.xyz - in.world);
  let form = book.kind.x;

  var albedo = book.board.rgb;
  // What a spine is before its wear, which is what its lettering is told from its cloth by.
  var surface = albedo;
  var roughness = 0.62;
  var metal = 0.0;
  switch (in.material) {
    case ${M.cover}u, ${M.behind}u: {
      roughness = select(0.5, 0.8, form == 2.0);
      if (book.board.w > 0.5) {
        albedo = cover * select(1.0, BEHIND, in.material == ${M.behind}u);
      }
      if (form < 1.5) {
        albedo = embossed(albedo, in.uv, (form < 0.5), (book.kind.y > 0.5), book.letter.w);
      }
    }
    case ${M.edges}u: {
      // Cut paper seen edge on: sheets stacked through the book's thickness.
      albedo = mix(PAPER, PAPER_CUT, step(0.5, fract(in.local.z / 1.6)));
      roughness = 0.95;
    }
    case ${M.page}u: {
      albedo = PAPER;
      roughness = 0.95;
    }
    case ${M.spine}u: {
      surface = select(book.board.rgb, spine, book.cloth.w > 0.5);
      albedo = rubbedEnds(surface, in.uv, book.letter.w);
      roughness = 0.5;
    }
    case ${M.print}u: {
      albedo = PRINT;
      roughness = 0.85;
    }
    case ${M.staple}u: {
      albedo = STAPLE;
      roughness = 0.3;
      metal = 1.0;
    }
    case ${M.plankTop}u: {
      albedo = frame.plank.rgb;
      roughness = 1.0;
    }
    case ${M.plankFront}u: {
      albedo = frame.plankFront.rgb;
      roughness = 1.0;
    }
    default: {}
  }

  var lit = shaded(albedo, roughness, metal, n, v, sun);
  switch (in.material) {
    case ${M.rim}u: {
      lit = frame.rim.rgb;
    }
    case ${M.staple}u: {}
    case ${M.plankTop}u: {
      lit = inked(lit, 1.0, frame.plankTone, cell);
    }
    case ${M.plankFront}u: {
      lit = inked(lit, 1.0, frame.frontTone, cell);
    }
    case ${M.spine}u: {
      lit = lettered(lit, surface, book.cloth.rgb, book.letter.rgb, book.place.w, frame.bookTone, cell);
    }
    default: {
      lit = inked(lit, book.place.w, frame.bookTone, cell);
    }
  }
  return vec4f(encode(lit), 1.0);
}

@vertex
fn backdropVertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  return vec4f(f32((index << 1u) & 2u) * 2.0 - 1.0, 1.0 - f32(index & 2u) * 2.0, 1.0, 1.0);
}

// Behind everything, a tone that thickens toward the stage's edges, in the books' own dither.
@fragment
fn backdropFragment(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let on = at.xy / frame.size.xy;
  let fromMiddle = length((on - vec2f(0.5, 0.46)) * vec2f(1.0, 1.2)) / 0.7071;
  // Thinning out again at the stage's top and bottom, so the row has no edge against the feed.
  let within = smoothstep(0.0, 0.2, on.y) * smoothstep(0.0, 0.2, 1.0 - on.y);
  let strength = smoothstep(0.5, 1.0, fromMiddle) * 0.32 * within;
  let cell = floor(at.xy / frame.sun.w);
  return vec4f(encode(mix(frame.paper.rgb, frame.backdrop.rgb, step(bayer(cell), strength))), 1.0);
}
`;

/** One picture drawn into the next size down of itself, for a texture's smaller copies. */
export const SHRINK_SHADER = /* wgsl */ `
@group(0) @binding(0) var picture: texture_2d<f32>;
@group(0) @binding(1) var pictureSampler: sampler;

struct Out {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vertex(@builtin(vertex_index) index: u32) -> Out {
  var out: Out;
  out.uv = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
  out.clip = vec4f(out.uv.x * 2.0 - 1.0, 1.0 - out.uv.y * 2.0, 0.0, 1.0);
  return out;
}

@fragment
fn fragment(in: Out) -> @location(0) vec4f {
  return textureSample(picture, pictureSampler, in.uv);
}
`;
