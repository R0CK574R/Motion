/**
 * Cathedral backdrop renderer (WebGL2).
 *
 * Draws a carved-stone Gothic facade that covers the whole viewport: a rose
 * window in the centre, an arcade of lancet windows on either side, and a
 * quatrefoil-diapered wall behind everything.
 *
 * Two shader passes:
 *   1. Scene: every pixel evaluates the facade as an analytic height field
 *      (circles, arcs and lines, folded by rotational symmetry) and writes its
 *      depth into a texture.
 *   2. Light: reads that depth back and lights it like stone — surface
 *      normals, soft cast shadows, ambient occlusion and grain. Window
 *      openings are cut clean through to pure black.
 *
 * The image is static. It renders once per size or theme change and never per
 * frame, so it costs nothing while someone scrolls or works.
 */

const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/* ------------------------------------------------------------------ *
 * Pass 1 — scene height field
 *
 * Coordinates are CSS pixels, y down. Heights are CSS px above the glass
 * plane. Each element works in its own units (the rose window's radius is 500
 * units, the lancet is 640 units tall) and converts to px with `k`.
 * ------------------------------------------------------------------ */
const SCENE_FS = `#version 300 es
precision highp float;

uniform vec2  uRes;    // render target, device px
uniform float uScale;  // device px per CSS px
uniform vec3  uRose;   // centre x, centre y, CSS px per rose unit
uniform vec4  uBay;    // first bay offset, bay step, CSS px per lancet unit, lancet origin y
uniform float uTile;   // wall lattice tile, CSS px
uniform float uDU;     // depth unit, CSS px
uniform float uZmax;   // CSS px stored as 1.0

out vec4 fragColor;

const float PI = 3.14159265359;
const float NEG = -1.0e5;

float aaPx;  // one device pixel, in CSS px

vec2 rot(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

// Fold p into the sector of an n-fold rotation centred on +x.
vec2 pmod(vec2 p, float n) {
  float s = 2.0 * PI / n;
  float a = mod(atan(p.y, p.x) + 0.5 * s, s) - 0.5 * s;
  return length(p) * vec2(cos(a), sin(a));
}

// n-lobed foil (trefoil, quatrefoil, sexfoil). Negative inside. The centre
// disc fills the middle when the lobes alone don't reach it.
float sdFoil(vec2 p, float n, float d, float r) {
  return min(length(pmod(p, n) - vec2(d, 0.0)) - r, length(p) - d);
}

// Pointed-arch window: half-width hw, springing line sy, arc radius rho,
// sill by. rho = 2*hw is the equilateral Gothic arch. Negative inside.
float sdArch(vec2 p, float hw, float sy, float rho, float by) {
  vec2 q = vec2(abs(p.x), p.y);
  // The head disc is deliberately not clipped at the springing line: it
  // overlaps the body there, so the union has no seam across the window.
  float head = max(length(q - vec2(hw - rho, sy)) - rho, q.y - by);
  float body = max(q.x - hw, max(sy - q.y, q.y - by));
  return min(head, body);
}

// Round moulding of half-width w: height above its base in px, NEG outside.
float roll(float d, float w, float k) {
  float x = d / w;
  if (x >= 1.0) return NEG;
  // The last device pixel eases down to the base, so the silhouette is
  // anti-aliased instead of a hard vertical edge.
  return sqrt(1.0 - x * x) * w * k * smoothstep(0.0, 1.0, (w - d) * k / aaPx);
}

// Flat-topped tracery bar with rounded shoulders, falling from top to base.
float bar(float d, float w, float top, float base) {
  if (d >= w) return NEG;
  float x = d / w;
  return mix(base, top, 1.0 - x * x * x * x);
}

// Plate at height zp, pierced by an opening (sdf in local units). The edge is
// rounded over (bullnose) and then drops to the floor zf.
float cut(float dOpen, float zp, float zf, float cw, float cd, float k) {
  float e = 1.0 - clamp(dOpen / cw, 0.0, 1.0);
  float zEdge = zp - cd * (1.0 - sqrt(max(0.0, 1.0 - e * e)));
  return mix(zf, zEdge, smoothstep(-aaPx, aaPx, dOpen * k));
}

// Anti-aliased step between two levels at x0.
float level(float x, float x0, float a, float b, float k) {
  return mix(a, b, smoothstep(-aaPx, aaPx, (x - x0) * k));
}

/* ---------------- Wall: quatrefoil diaper on pillowed ashlar ---------------- */
float zWall(vec2 p) {
  float T = uTile;
  vec2 t = p / T;
  float ua = fract(t.x - t.y) - 0.5;
  float ub = fract(t.x + t.y) - 0.5;
  vec2 c = vec2(ua + ub, ub - ua) * 0.5 * T;                 // px from diamond centre
  float dRib = (0.5 - max(abs(ua), abs(ub))) * 0.70710678 * T;
  float zb = 40.0 * uDU;

  float pill = 1.0 - pow(1.0 - clamp(dRib / (0.3536 * T), 0.0, 1.0), 2.0);
  float z = zb + 0.022 * T * pill;
  z = cut(sdFoil(c, 4.0, 0.12 * T, 0.13 * T), z, zb - 0.035 * T, 0.025 * T, 0.02 * T, 1.0);
  z = max(z, zb - 0.035 * T + roll(length(c), 0.04 * T, 1.0));
  z = max(z, zb - 0.006 * T + roll(dRib, 0.028 * T, 1.0));
  vec2 ac = abs(c);
  float dv = min(length(ac - vec2(0.5 * T, 0.0)), length(ac - vec2(0.0, 0.5 * T)));
  z = max(z, zb + roll(dv, 0.065 * T, 1.0));
  return z;
}

/* ---------------- Rose window (radius 500 units) ---------------- */
float zRose(vec2 q, float k) {
  float du = uDU;
  float r = length(q);
  float z;

  if (r > 462.0) {
    // Archivolt: inner roll, a channel of 96 beads, a heavy outer torus.
    z = level(r, 471.0, 25.0 * du, 31.0 * du, k);
    z = level(r, 490.0, z, 39.0 * du, k);
    z = max(z, 24.0 * du + roll(abs(r - 466.0), 4.5, k));
    z = max(z, 31.0 * du + roll(length(pmod(q, 96.0) - vec2(480.5, 0.0)), 6.5, k));
    z = max(z, 39.0 * du + roll(abs(r - 509.0), 18.0, k));
    return z;
  }

  if (r > 354.0) {
    // 24 pointed lights in a pierced stone plate, trefoils in the spandrels.
    vec2 a = pmod(rot(q, -PI / 24.0), 24.0);
    float v = abs(a.y);
    float dHead = max(length(vec2(a.x - 386.0, v + 38.0)) - 76.0, 364.0 - a.x);
    float dLegs = max(v - 38.0, max(364.0 - a.x, a.x - 386.0));
    float dLight = min(dHead, dLegs);
    float dTre = sdFoil(pmod(q, 24.0) - vec2(436.0, 0.0), 3.0, 9.0, 10.5);
    z = cut(min(dLight, dTre), 24.0 * du, 0.0, 6.0, 7.0 * du, k);
  } else if (r > 184.0) {
    // Ring of 12 roundels with quatrefoil cusping, spokes between them.
    vec2 a = pmod(q, 12.0);
    float v = abs(a.y);
    z = 0.0;
    float dS = abs(dot(vec2(a.x, v), vec2(-sin(PI / 12.0), cos(PI / 12.0))));
    z = max(z, bar(dS, 7.0, 25.0 * du, 0.0));
    vec2 c = vec2(a.x - 270.0, a.y);
    float dr = length(c);
    z = max(z, bar(abs(dr - 57.0), 6.0, 26.0 * du, 0.0));
    if (dr < 54.0) z = max(z, cut(sdFoil(c, 4.0, 23.0, 21.0), 21.0 * du, 0.0, 5.0, 5.0 * du, k));
    else z = max(z, bar(v, 6.0, 25.0 * du, 0.0));
  } else if (r > 62.0) {
    // Twelve large petals with twelve small ones between.
    vec2 a = pmod(q, 12.0);
    float dBig = length(vec2(a.x - 121.0, abs(a.y) + 51.43)) - 72.43;
    vec2 b = pmod(rot(q, -PI / 12.0), 12.0);
    float dSmall = length(vec2(b.x - 147.0, abs(b.y) + 30.2)) - 39.2;
    z = cut(min(dBig, dSmall), 24.0 * du, 0.0, 6.0, 6.0 * du, k);
  } else {
    // Hub: sunken sexfoil around a domed boss.
    z = cut(sdFoil(q, 6.0, 26.0, 21.0), 29.0 * du, 21.0 * du, 4.0, 4.0 * du, k);
    z = max(z, 21.0 * du + roll(r, 12.0, k));
  }

  z = max(z, bar(abs(r - 354.0), 9.0, 27.0 * du, 0.0));
  z = max(z, bar(abs(r - 184.0), 8.0, 27.0 * du, 0.0));
  z = max(z, 25.0 * du + roll(abs(r - 62.0), 5.0, k));
  return z;
}

/* ---------------- Lancet bay (640 units tall) ---------------- */
float zLancet(vec2 l, float k, float zw) {
  float du = uDU;
  float x = abs(l.x), y = l.y;

  // Colonnettes with bell capitals and moulded bases.
  float zc = NEG;
  if (y > 188.0 && y < 652.0) {
    float rad = 9.0;
    rad = mix(rad, 14.0, smoothstep(214.0, 200.0, y));
    rad = mix(rad, 13.5, smoothstep(626.0, 636.0, y));
    zc = 38.0 * du + roll(abs(x - 146.0), rad, k);
    if (y < 200.0) zc = max(zc, 38.0 * du + roll(max(abs(x - 146.0) - 9.0, 0.0), 8.0, k));
  }

  float s = sdArch(vec2(x, y), 120.0, 215.0, 240.0, 640.0);
  if (s > 18.0) return max(zw, zc);

  float z;
  if (s > -14.0) {
    // Archivolt stepping inward toward the tracery.
    z = level(s, -6.0, 25.0 * du, 33.0 * du, k);
    z = max(z, 39.0 * du + roll(abs(s - 9.0), 9.0, k));
    z = max(z, 32.0 * du + roll(abs(s + 2.0), 4.5, k));
    z = max(z, 24.0 * du + roll(abs(s + 10.5), 3.5, k));
    return max(z, zc);
  }

  // Tracery: two lights under a cusped roundel, pierced spandrels.
  vec2 p = vec2(x, y);
  float dSub = sdArch(vec2(x - 56.0, y), 42.0, 330.0, 84.0, 612.0);
  float dQ = sdFoil(rot(p - vec2(0.0, 244.0), PI / 4.0), 4.0, 8.0, 9.0);
  float dT = sdFoil(rot(p - vec2(86.0, 262.0), PI / 2.0), 3.0, 6.5, 7.5);

  z = cut(min(dSub, min(dQ, dT)), 24.0 * du, 0.0, 5.0, 6.0 * du, k);

  vec2 rc = p - vec2(0.0, 150.0);
  float dR = length(rc);
  if (dR < 63.0) z = cut(sdFoil(rc, 6.0, 30.0, 24.0), 22.0 * du, 0.0, 4.0, 5.0 * du, k);
  z = max(z, bar(abs(dR - 66.0), 5.0, 27.0 * du, 20.0 * du));
  if (y > 250.0 && y < 616.0) z = max(z, 21.0 * du + roll(x, 10.0, k));
  return max(z, zc);
}

float zScene(vec2 p) {
  vec2 rq = (p - uRose.xy) / uRose.z;
  float z;
  if (length(rq) < 528.0) {
    z = zRose(rq, uRose.z);
  } else {
    z = zWall(p);
    float ax = abs(p.x - uRose.x) - uBay.x;
    if (ax > -0.5 * uBay.y) {
      float kb = max(0.0, floor(ax / uBay.y + 0.5));
      vec2 l = vec2(ax - kb * uBay.y, p.y - uBay.w) / uBay.z;
      z = zLancet(l, uBay.z, z);
    }
  }
  return z;
}

void main() {
  aaPx = 1.0 / uScale;
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uScale;
  float z = zScene(p);
  float v = floor(clamp(z / uZmax, 0.0, 1.0) * 65535.0 + 0.5);
  float hi = floor(v / 256.0);
  fragColor = vec4(hi / 255.0, (v - hi * 256.0) / 255.0, 0.0, 1.0);
}`;

/* ------------------------------------------------------------------ *
 * Pass 2 — light the carved stone
 *
 * Works in device pixels with GL's y-up axis. Depth is converted to device
 * px so slopes are physically consistent with the height field.
 * ------------------------------------------------------------------ */
const LIGHT_FS = `#version 300 es
precision highp float;

uniform highp sampler2D uTex;
uniform vec2  uRes;
uniform float uScale;
uniform float uZmaxR;      // device px stored as 1.0
uniform float uDUR;        // depth unit, device px
uniform vec3  uL;          // unit vector toward the light
uniform vec3  uLightCol;
uniform vec3  uSky;
uniform vec3  uGround;
uniform vec3  uStoneA;
uniform vec3  uStoneB;
uniform float uSpec;
uniform float uShine;
uniform vec3  uBg;
uniform float uStrength;
uniform float uVignette;
uniform vec2  uPool;
uniform float uPoolAmt;
uniform float uDither;

out vec4 fragColor;

ivec2 gMax;

float Zt(ivec2 c) {
  vec4 t = texelFetch(uTex, clamp(c, ivec2(0), gMax), 0);
  return (floor(t.r * 255.0 + 0.5) * 256.0 + floor(t.g * 255.0 + 0.5)) * (uZmaxR / 65535.0);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return s;
}

void main() {
  gMax = ivec2(uRes) - 1;
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec2 fc = gl_FragCoord.xy;
  vec2 pc = vec2(fc.x, uRes.y - fc.y) / uScale;   // CSS px, y down
  float z0 = Zt(ip);

  // Surface normal from a Sobel filter over the height field.
  float tl = Zt(ip + ivec2(-1, 1)), tc = Zt(ip + ivec2(0, 1)), tr = Zt(ip + ivec2(1, 1));
  float ml = Zt(ip + ivec2(-1, 0)), mr = Zt(ip + ivec2(1, 0));
  float bl = Zt(ip + ivec2(-1, -1)), bc = Zt(ip + ivec2(0, -1)), br = Zt(ip + ivec2(1, -1));
  float gx = (tr + 2.0 * mr + br - tl - 2.0 * ml - bl) / 8.0;
  float gy = (tl + 2.0 * tc + tr - bl - 2.0 * bc - br) / 8.0;

  // Stone grain: a faint micro-relief so surfaces read as stone, not plastic.
  float gf = min(0.42, uScale / 3.2);
  float g0 = vnoise(pc * gf);
  float gxN = vnoise(pc * gf + vec2(0.35, 0.0)) - g0;
  float gyN = vnoise(pc * gf + vec2(0.0, 0.35)) - g0;
  vec3 n = normalize(vec3(-gx + gxN * 0.18, -gy - gyN * 0.18, 1.0));

  // Openings: anything at the back plane is a void. Coverage is anti-aliased
  // across the one-pixel cliff where stone drops into it.
  float hole = 1.0 - smoothstep(0.5 * uDUR, 1.3 * uDUR, z0);

  // Soft cast shadows: march toward the light over the height field.
  vec2 Ld = normalize(uL.xy);
  float tanE = uL.z / length(uL.xy);
  // Per-pixel jitter turns sampling stair-steps into fine, natural penumbra.
  float sh = 1.0;
  float jit = hash12(fc * 1.37 + 11.0);
  for (int i = 0; i < 26; i++) {
    float t = pow(float(i) + 0.6 + jit, 1.55) * 0.8 * uScale;
    float zq = Zt(ivec2(fc + Ld * t));
    sh = min(sh, 6.0 * (z0 + t * tanE - zq) / t);
  }
  sh = smoothstep(0.0, 1.0, sh);

  // Ambient occlusion from four rings of samples.
  float occ = 0.0;
  for (int ring = 0; ring < 4; ring++) {
    float rad = (ring == 0 ? 2.5 : ring == 1 ? 7.0 : ring == 2 ? 16.0 : 34.0) * uScale;
    float w = ring == 0 ? 0.30 : ring == 1 ? 0.30 : ring == 2 ? 0.24 : 0.16;
    float acc = 0.0;
    for (int j = 0; j < 8; j++) {
      float ang = (float(j) + 0.5 * float(ring)) * 0.78539816;
      float zq = Zt(ivec2(fc + vec2(cos(ang), sin(ang)) * rad));
      acc += clamp((zq - z0) / rad, 0.0, 1.0);
    }
    occ += w * acc / 8.0;
  }
  float ao = clamp(1.0 - occ * 1.6, 0.0, 1.0);

  vec3 V = vec3(0.0, 0.0, 1.0);
  float ndl = max(dot(n, uL), 0.0);
  vec3 hemi = mix(uGround, uSky, 0.5 + 0.5 * n.y);
  float spec = uSpec * pow(max(dot(n, normalize(uL + V)), 0.0), uShine) * sh;

  // Stone: large mottling, fine grain, grime collecting in deep recesses.
  float mot = fbm(pc * 0.012);
  vec3 alb = mix(uStoneA, uStoneB, smoothstep(0.3, 0.7, mot));
  alb *= 0.94 + 0.12 * (fbm(pc * min(0.21, uScale / 6.0) + 5.3) - 0.5);
  alb *= mix(0.80, 1.0, smoothstep(0.0, 0.55, z0 / uZmaxR));
  vec3 col = alb * (uLightCol * ndl * sh + hemi * ao) + uLightCol * spec;

  // Light falls off across the wall, and the frame edges sink into shadow.
  vec2 uv = fc / uRes;
  float aspect = uRes.x / uRes.y;
  float dPool = distance(vec2(uv.x * aspect, 1.0 - uv.y), vec2(uPool.x * aspect, uPool.y));
  col *= 1.0 + uPoolAmt * (0.5 - smoothstep(0.0, 1.3, dPool));
  col *= 1.0 - uVignette * pow(clamp(length(uv - 0.5) * 1.3, 0.0, 1.0), 2.2);

  col = mix(uBg, col, uStrength);
  // Openings go to pure black last, so no tint, light or wash reaches them.
  col = mix(col, vec3(0.0), hole);
  col = pow(max(col, 0.0), vec3(1.0 / 2.2));
  // Dither so gradients never band, but never on the black voids.
  col += uDither * (1.0 - hole) * (hash12(fc + 0.37) - 0.5) / 255.0;
  fragColor = vec4(max(col, 0.0), 1.0);
}`;

/* ------------------------------------------------------------------ *
 * Pass 3 — resolve the supersampled image down to the screen
 *
 * Four bilinear taps spread across each screen pixel's footprint: an exact
 * 2x2 box filter at 2:1, a close approximation at other ratios.
 * ------------------------------------------------------------------ */
const RESOLVE_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uSrcRes;
uniform vec2 uDstRes;
out vec4 fragColor;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uDstRes;
  vec2 o = 0.25 * max(uSrcRes / uDstRes, vec2(1.0)) / uSrcRes;
  vec3 c = texture(uSrc, uv + vec2(-o.x, -o.y)).rgb
         + texture(uSrc, uv + vec2( o.x, -o.y)).rgb
         + texture(uSrc, uv + vec2(-o.x,  o.y)).rgb
         + texture(uSrc, uv + vec2( o.x,  o.y)).rgb;
  c *= 0.25;
  // Dither everything except true black, which must stay exactly 0.
  float lit = smoothstep(0.0, 2.0 / 255.0, max(c.r, max(c.g, c.b)));
  c += lit * (hash12(gl_FragCoord.xy + 0.37) - 0.5) / 255.0;
  fragColor = vec4(max(c, 0.0), 1.0);
}`;

/* ------------------------------------------------------------------ *
 * Theme presets (sRGB hex in, linear floats to the shader)
 * ------------------------------------------------------------------ */
function lin(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
}
const scale3 = (v, k) => v.map((c) => c * k);

/** Light vector: azimuth in degrees (0 = right, 90 = up), elevation above the wall. */
function lightDir(azimuthDeg, elevationDeg) {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  return [Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el)];
}

export const CATHEDRAL_PRESETS = {
  // Morning sun on pale limestone.
  light: {
    light: lightDir(132, 36),
    lightCol: scale3(lin("#fff3e2"), 1.18),
    sky: scale3(lin("#dfe7f1"), 0.34),
    ground: scale3(lin("#e6ded3"), 0.22),
    stoneA: lin("#e3e1dd"),
    stoneB: lin("#d4d2cd"),
    spec: 0.10,
    shine: 28,
    bg: lin("#f5f5f5"),
    strength: 0.9,
    vignette: 0.16,
    pool: [0.28, 0.78],
    poolAmt: 0.12,
  },
  // Moonlit stone: silver tracery around black openings.
  dark: {
    light: lightDir(124, 34),
    lightCol: scale3(lin("#dfe6ff"), 0.21),
    sky: scale3(lin("#9fb0d0"), 0.014),
    ground: scale3(lin("#3a3633"), 0.012),
    stoneA: lin("#aaa8a4"),
    stoneB: lin("#9a9893"),
    spec: 1.1,
    shine: 34,
    bg: lin("#0d0d0d"),
    strength: 0.97,
    vignette: 0.36,
    pool: [0.5, 0.56],
    poolAmt: 0.32,
  },
};

/* ------------------------------------------------------------------ *
 * Composition: where the rose and the lancet bays sit for a viewport
 * ------------------------------------------------------------------ */
export function cathedralLayout(width, height) {
  const R = Math.min(0.47 * height, 0.6 * width); // rose radius = 500 rose units
  const ru = R / 500;
  const lu = (0.84 * height) / 665; // lancet: 665 units incl. its frame
  const cx = width / 2;
  const cy = height / 2;
  return {
    rose: [cx, cy, ru],
    bay: [528 * ru + 172 * lu, 340 * lu, lu, cy - 323.5 * lu],
    tile: Math.min(96, Math.max(46, 0.068 * Math.min(height, 1.6 * width))),
    du: 1.06 * ru,
    zmax: 72 * 1.06 * ru,
  };
}

/* ------------------------------------------------------------------ *
 * Renderer
 * ------------------------------------------------------------------ */
function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`Cathedral shader failed to compile: ${log}`);
  }
  return sh;
}

function program(gl, fsSrc) {
  const p = gl.createProgram();
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(`Cathedral program failed to link: ${gl.getProgramInfoLog(p)}`);
  }
  const loc = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const { name } = gl.getActiveUniform(p, i);
    loc[name] = gl.getUniformLocation(p, name);
  }
  return { p, loc };
}

/**
 * Returns a renderer bound to `canvas`, or null when WebGL2 isn't available
 * or the shaders won't compile — the caller falls back to line art.
 */
export function createCathedral(canvas) {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true, // lets the theme cross-fade snapshot the last frame
    powerPreference: "low-power",
  });
  if (!gl) return null;

  let scene;
  let light;
  let resolve;
  try {
    scene = program(gl, SCENE_FS);
    light = program(gl, LIGHT_FS);
    resolve = program(gl, RESOLVE_FS);
  } catch (err) {
    console.warn(err.message);
    return null;
  }

  const vao = gl.createVertexArray();
  const heightTex = gl.createTexture();
  const heightFbo = gl.createFramebuffer();
  const colorTex = gl.createTexture();
  const colorFbo = gl.createFramebuffer();
  const maxDim = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), ...gl.getParameter(gl.MAX_VIEWPORT_DIMS));
  let size = null;

  function target(tex, fbo, w, h, filter) {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) throw new Error("Cathedral framebuffer incomplete");
  }

  function fullscreen() {
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function drawScene() {
    const { iw, ih, iscale, layout } = size;
    gl.bindFramebuffer(gl.FRAMEBUFFER, heightFbo);
    gl.viewport(0, 0, iw, ih);
    gl.useProgram(scene.p);
    const L = scene.loc;
    gl.uniform2f(L.uRes, iw, ih);
    gl.uniform1f(L.uScale, iscale);
    gl.uniform3fv(L.uRose, layout.rose);
    gl.uniform4fv(L.uBay, layout.bay);
    gl.uniform1f(L.uTile, layout.tile);
    gl.uniform1f(L.uDU, layout.du);
    gl.uniform1f(L.uZmax, layout.zmax);
    fullscreen();
  }

  function drawLight(preset) {
    const { iw, ih, iscale, layout, direct } = size;
    gl.bindFramebuffer(gl.FRAMEBUFFER, direct ? null : colorFbo);
    gl.viewport(0, 0, iw, ih);
    gl.useProgram(light.p);
    const L = light.loc;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, heightTex);
    gl.uniform1i(L.uTex, 0);
    gl.uniform2f(L.uRes, iw, ih);
    gl.uniform1f(L.uScale, iscale);
    gl.uniform1f(L.uZmaxR, layout.zmax * iscale);
    gl.uniform1f(L.uDUR, layout.du * iscale);
    gl.uniform3fv(L.uL, preset.light);
    gl.uniform3fv(L.uLightCol, preset.lightCol);
    gl.uniform3fv(L.uSky, preset.sky);
    gl.uniform3fv(L.uGround, preset.ground);
    gl.uniform3fv(L.uStoneA, preset.stoneA);
    gl.uniform3fv(L.uStoneB, preset.stoneB);
    gl.uniform1f(L.uSpec, preset.spec);
    gl.uniform1f(L.uShine, preset.shine);
    gl.uniform3fv(L.uBg, preset.bg);
    gl.uniform1f(L.uStrength, preset.strength);
    gl.uniform1f(L.uVignette, preset.vignette);
    gl.uniform2fv(L.uPool, preset.pool);
    gl.uniform1f(L.uPoolAmt, preset.poolAmt);
    gl.uniform1f(L.uDither, direct ? 1 : 0);
    fullscreen();
  }

  function drawResolve() {
    const { iw, ih, dw, dh } = size;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, dw, dh);
    gl.useProgram(resolve.p);
    const L = resolve.loc;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, colorTex);
    gl.uniform1i(L.uSrc, 0);
    gl.uniform2f(L.uSrcRes, iw, ih);
    gl.uniform2f(L.uDstRes, dw, dh);
    fullscreen();
  }

  return {
    /**
     * Render for a CSS size. `deviceScale` sizes the canvas to the screen;
     * `internalScale` is how finely the facade is computed. When internal is
     * finer than the screen the image is supersampled and filtered down, so
     * ordinary 1x monitors get Retina-quality edges. The scene pass re-runs
     * only when a size changes; a theme change only re-lights.
     */
    render({ width, height, deviceScale = 1, internalScale = deviceScale, preset, sync = false }) {
      if (gl.isContextLost()) return null;
      const t0 = performance.now();
      const cssW = Math.max(1, Math.round(width));
      const cssH = Math.max(1, Math.round(height));
      const fit = (k) => Math.min(k, maxDim / cssW, maxDim / cssH);
      const dw = Math.max(1, Math.floor(cssW * fit(deviceScale)));
      const dh = Math.max(1, Math.floor(cssH * fit(deviceScale)));
      const iw = Math.max(1, Math.floor(cssW * fit(internalScale)));
      const ih = Math.max(1, Math.floor(cssH * fit(internalScale)));
      const changed =
        !size || size.iw !== iw || size.ih !== ih || size.dw !== dw || size.dh !== dh ||
        size.cssW !== cssW || size.cssH !== cssH;
      if (changed) {
        canvas.width = dw;
        canvas.height = dh;
        const direct = iw === dw && ih === dh;
        size = { iw, ih, dw, dh, cssW, cssH, direct, iscale: iw / cssW, layout: cathedralLayout(cssW, cssH) };
        target(heightTex, heightFbo, iw, ih, gl.NEAREST);
        if (!direct) target(colorTex, colorFbo, iw, ih, gl.LINEAR);
        drawScene();
      }
      drawLight(preset);
      if (!size.direct) drawResolve();
      if (sync) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      return { ms: performance.now() - t0, internal: [iw, ih], device: [dw, dh], rescene: changed };
    },
    dispose() {
      gl.deleteTexture(heightTex);
      gl.deleteTexture(colorTex);
      gl.deleteFramebuffer(heightFbo);
      gl.deleteFramebuffer(colorFbo);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(scene.p);
      gl.deleteProgram(light.p);
      gl.deleteProgram(resolve.p);
    },
  };
}
