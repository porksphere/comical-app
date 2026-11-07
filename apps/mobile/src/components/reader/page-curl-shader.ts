// The page curl as a Skia runtime effect (SkSL). Kept free of React Native so a test can compile it
// with CanvasKit and check what it draws (`page-curl-shader.test.ts`).
//
// Two pictures go in, the spread being left (`cur`) and the one being turned to (`next`), both as
// the screen draws them. The geometry comes from `page-curl-geometry`, in TURN space: the leaf to
// the right of the spine, carried over to the left. `mirrored` flips turn space onto the screen for
// a turn that runs the other way, and the pictures are sampled through the same flip.
//
// The paper rolls over a cylinder of radius `r` whose axis is the fold line `dot(p, n) = c`; `n`
// points toward the free edge. A screen point a distance `d` past the fold sees the paper whose
// distance from the fold, measured along the paper, puts it there: flat behind the fold (d < 0, the
// page itself, and the part turned back over it), around the cylinder (0 ≤ d ≤ r, the underside and
// the top of the roll), and nothing beyond it (the page underneath, in the curl's shadow).

import type { CurlFrame, Leaf } from '@/components/reader/page-curl-geometry';

/** The effect's uniforms, by name, for one frame of a turn. */
export function curlUniforms(
  size: { width: number; height: number },
  mirrored: boolean,
  leaf: Leaf,
  frame: CurlFrame,
  density: number,
) {
  'worklet';
  const { box, radii } = leaf;
  return {
    size: [size.width, size.height],
    mirrored: mirrored ? 1 : 0,
    leaf: [box.x, box.y, box.width, box.height],
    leafR: [radii[0], radii[1], radii[2], radii[3]],
    spine: leaf.spine,
    dual: leaf.dual ? 1 : 0,
    n: [frame.nx, frame.ny],
    c: frame.c,
    r: frame.r,
    shade: frame.shade,
    density,
  };
}

/** The same, flat, in the order the effect declares them — what `makeShaderWithChildren` takes. */
export function curlUniformArray(uniforms: ReturnType<typeof curlUniforms>): number[] {
  const u = uniforms;
  return [...u.size, u.mirrored, ...u.leaf, ...u.leafR, u.spine, u.dual, ...u.n, u.c, u.r, u.shade, u.density];
}

export const CURL_SKSL = `
uniform shader cur;
uniform shader next;
uniform float2 size;
uniform float mirrored;
uniform float4 leaf;
uniform float4 leafR;
uniform float spine;
uniform float dual;
uniform float2 n;
uniform float c;
uniform float r;
uniform float shade;
uniform float density;

const float PI = 3.14159265;
const float SHADOW_REACH = 1.7;
// The shadows are screentone, not photographs: a dot where an ordered dither puts one for the
// shadow's strength there, each dot DOT device pixels square and this dark.
const float DOT = 3.0;
const float SHADOW_INK = 0.8;
// The ink line drawn round the lifted paper: half its width in points, and how much it darkens.
const float OUTLINE = 0.75;
const float OUTLINE_INK = 0.65;

float2 screen(float2 q) { return mirrored > 0.5 ? float2(size.x - q.x, q.y) : q; }
float3 pageA(float2 q) { return cur.eval(screen(q)).rgb; }
float3 pageB(float2 q) { return next.eval(screen(q)).rgb; }

float leafDistance(float2 p) {
  float2 b = leaf.zw * 0.5;
  float2 q0 = p - (leaf.xy + b);
  float rad = q0.x < 0.0 ? (q0.y < 0.0 ? leafR.x : leafR.w) : (q0.y < 0.0 ? leafR.y : leafR.z);
  float2 q = abs(q0) - b + rad;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - rad;
}
float onLeaf(float2 p) { return clamp(0.5 - leafDistance(p) * density, 0.0, 1.0); }
// The leaf's box with its corners square. Outside a rounded corner is no paper, but it is still the
// page as drawn there until that part has turned — the next page must not show in the corner.
float onBox(float2 p) {
  float2 q = abs(p - (leaf.xy + leaf.zw * 0.5)) - leaf.zw * 0.5;
  return clamp(0.5 - max(q.x, q.y) * density, 0.0, 1.0);
}
// Light on the roll's top, by how far round it the paper has come: full where it leaves the flap,
// so the two meet without a seam, falling toward the roll's far side, with a faint glint.
float rollLight(float a) {
  float glint = (a - 0.45) / 0.2;
  return 0.62 + 0.38 * cos(a) + 0.06 * exp(-glint * glint);
}

float ink(float distance) {
  return 1.0 - smoothstep(OUTLINE - 0.5 / density, OUTLINE + 0.5 / density, abs(distance));
}
// The 4×4 Bayer matrix's threshold for a dot cell, 1/32 to 31/32: the bits of the cell's x and y,
// interleaved and reversed, which is the matrix without a table.
float bayer(float2 cell) {
  float2 q = floor(mod(cell, 4.0));
  float x0 = mod(q.x, 2.0);
  float y0 = mod(q.y, 2.0);
  float x1 = floor(q.x / 2.0);
  float y1 = floor(q.y / 2.0);
  return (mod(x0 + y0, 2.0) * 8.0 + y0 * 4.0 + mod(x1 + y1, 2.0) * 2.0 + y1) / 16.0 + 1.0 / 32.0;
}
// A shadow of strength \`s\` (0..1) at screen point \`at\`, as a dot or not: dots where the dither's
// threshold falls under the strength, so their density is the shade.
float tone(float s, float2 at) {
  return s > bayer(floor(at * density / DOT)) ? 1.0 : 0.0;
}
// How far the paper point \`q\`, carried round the roll at angle \`a\`, lies from the leaf's edge, as
// measured on the screen: the roll squeezes the paper across the fold by cos(a) and not along it.
float rolledEdge(float2 q, float a) {
  float e = leafDistance(q);
  float gn = (leafDistance(q + n * 0.5) - e) * 2.0;
  float gt = (leafDistance(q + float2(-n.y, n.x) * 0.5) - e) * 2.0;
  return e / max(length(float2(gt, gn / max(cos(a), 0.15))), 0.001);
}

// The leaf's back. Two-sided, it is the facing page of the spread being turned to, printed where it
// lands once the leaf lies flat across the spine. One-sided, it is paper, the page showing through.
float3 back(float2 q) {
  if (dual > 0.5) return pageB(float2(2.0 * spine - q.x, q.y));
  return mix(float3(0.96, 0.95, 0.92), pageA(q), 0.16);
}

half4 main(float2 at) {
  float2 p = screen(at);
  float3 col = (dual > 0.5 && p.x < spine) ? pageA(p) : pageB(p);
  float R = max(r, 0.75);
  float d = dot(p, n) - c;
  float outline = 0.0;
  if (d >= 0.0) {
    // The lifted paper's shadow on the page beneath, laid down before the paper so the roll covers
    // it: darkest at the crease and falling away from it, and only where the crease runs across the
    // leaf. Measured from the roll's edge instead, it stood beside the paper as a band wherever the
    // paper ran out short of the roll, near the corners and off the page.
    // Against the leaf's square box, not its rounded outline: the crease runs the page's full
    // height, and under a display's wide corner the outline put the top of the shadow well past
    // the roll.
    float2 crease = p - n * d;
    float2 cq = abs(crease - (leaf.xy + leaf.zw * 0.5)) - leaf.zw * 0.5;
    float casting = 1.0 - smoothstep(0.0, R * 0.5 + 4.0, max(cq.x, cq.y));
    col *= 1.0 - SHADOW_INK * tone(shade * casting * exp(-d / (R * SHADOW_REACH + 6.0)), at);
    if (d <= R) {
      float a = asin(d / R);
      float2 under = p + n * (R * a - d);
      float2 over = p + n * (R * (PI - a) - d);
      float overC = onLeaf(over);
      col = mix(col, pageA(under) * (0.5 + 0.5 * cos(a)), onLeaf(under));
      col = mix(col, back(over) * rollLight(a), overC);
      outline = max(ink(rolledEdge(over, a)), ink(rolledEdge(under, a)) * (1.0 - overC));
    }
    // The roll's own outline, where the paper reaches round to it.
    outline = max(outline, ink(d - R) * onLeaf(p + n * (R * PI * 0.5 - d)));
  } else {
    float2 flap = p + n * (PI * R - 2.0 * d);
    float flapD = leafDistance(flap);
    float flapC = clamp(0.5 - flapD * density, 0.0, 1.0);
    col = mix(col, pageA(p), onBox(p));
    // The turned-over flap's shadow falls from its outer edge; at the crease, where the flap's edge
    // meets the roll, it would draw a dark line down the flat page.
    col *= 1.0 - SHADOW_INK * tone(shade * (1.0 - flapC) * 0.4 * exp(-max(flapD, 0.0) / (R * 0.45 + 4.0)) * smoothstep(0.0, R * 0.6, -d), at);
    col = mix(col, back(flap) * rollLight(0.0), flapC);
    outline = ink(flapD);
  }
  // Drawn, not photographed: the turning paper is outlined, fading in and out with the turn.
  col = mix(col, float3(0.12, 0.12, 0.13), shade * OUTLINE_INK * outline);
  return half4(half3(col), 1.0);
}
`;
