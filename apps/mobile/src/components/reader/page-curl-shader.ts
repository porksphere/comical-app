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

// How far the paper reaches past the fold from its point \`f\`, along \`n\`: where that line leaves
// the leaf's box, or 0 where it never crosses it.
float reach(float2 f) {
  float2 lo = leaf.xy;
  float2 hi = leaf.xy + leaf.zw;
  float exitX = n.x > 0.0001 ? (hi.x - f.x) / n.x : (n.x < -0.0001 ? (lo.x - f.x) / n.x : 1e6);
  float exitY = n.y > 0.0001 ? (hi.y - f.y) / n.y : (n.y < -0.0001 ? (lo.y - f.y) / n.y : 1e6);
  float entryX = n.x > 0.0001 ? (lo.x - f.x) / n.x : (n.x < -0.0001 ? (hi.x - f.x) / n.x : -1e6);
  float entryY = n.y > 0.0001 ? (lo.y - f.y) / n.y : (n.y < -0.0001 ? (hi.y - f.y) / n.y : -1e6);
  float exit = min(exitX, exitY);
  return exit > max(max(entryX, entryY), 0.0) ? exit : 0.0;
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
  // The roll is never wider than the paper that has gone into it: toward the end of a diagonal fold,
  // where only a sliver has lifted, it tightens to that sliver, so the paper always comes over the
  // top rather than standing as a squeezed strip of its own front beside the page.
  // Eased into the full radius rather than cut off at it, or the flap's outline kinks where the two
  // meet.
  float fit = reach(p - n * d) / PI;
  float ease = R * 0.6;
  float h = max(ease - abs(fit - R), 0.0) / ease;
  float Rl = max(min(fit, R) - h * h * ease * 0.25, 0.75);
  if (d > Rl) {
    col *= 1.0 - shade * 0.55 * (Rl / R) * exp(-(d - Rl) / (R * 1.4 + 6.0));
  } else if (d >= 0.0) {
    float a = asin(d / Rl);
    float2 under = p + n * (Rl * a - d);
    float2 over = p + n * (Rl * (PI - a) - d);
    float underC = onLeaf(under);
    float overC = onLeaf(over);
    col *= 1.0 - shade * 0.55 * (1.0 - underC);
    col = mix(col, pageA(under) * (0.5 + 0.5 * cos(a)), underC);
    col = mix(col, back(over) * rollLight(a), overC);
  } else {
    float2 flap = p + n * (PI * Rl - 2.0 * d);
    float flapD = leafDistance(flap);
    float flapC = clamp(0.5 - flapD * density, 0.0, 1.0);
    col = mix(col, pageA(p), onBox(p));
    // The turned-over flap's shadow falls from its outer edge; at the fold itself, where the flap's
    // edge meets the roll, it would draw a crease down the flat page.
    col *= 1.0 - shade * (1.0 - flapC) * 0.4 * exp(-max(flapD, 0.0) / (R * 0.45 + 4.0)) * smoothstep(0.0, R * 0.6, -d);
    col = mix(col, back(flap) * rollLight(0.0), flapC);
  }
  return half4(half3(col), 1.0);
}
`;
