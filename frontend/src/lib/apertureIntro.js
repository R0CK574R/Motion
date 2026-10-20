/**
 * Intro animation: Motion's aperture mark as a carved-stone iris.
 *
 * The logo swings up to face the viewer while light sweeps across it, the
 * six blades open, and the view flies through the opening into the app. The
 * opening is transparent, so whatever is behind the overlay (the cathedral
 * backdrop and the first screen) shows through as the iris opens.
 *
 * One fragment shader per frame, no textures. The geometry matches the
 * lucide Aperture icon used in the header: six blades whose inner edges form a
 * flat-topped hexagon, each edge running on clockwise to the rim as the seam
 * over the next blade.
 */

const INTRO_VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const INTRO_FRAG = `#version 300 es
precision highp float;

uniform vec2  uRes;       // device px
uniform float uScale;     // device px per CSS px
uniform vec2  uCenter;    // logo centre, CSS px, y down
uniform float uR;         // CSS px per logo unit (outer rim = 1)
uniform float uTilt;      // logo plane tipped back about the x axis, radians
uniform float uAp;        // opening: hexagon apothem in logo units (0 = shut)
uniform float uRot;       // blade rotation, radians
uniform float uFade;      // logo fade-in, 0..1
uniform vec3  uL;         // unit vector toward the light: x right, y down, z to viewer
uniform vec3  uLightCol;
uniform vec3  uSky;
uniform vec3  uGround;
uniform vec3  uStoneA;
uniform vec3  uStoneB;
uniform vec3  uBg;
uniform float uSpec;
uniform float uShine;

out vec4 fragColor;

const float PI = 3.14159265359;
const float SEG = PI / 3.0;        // six blades
const float RING_IN = 0.80;        // blades end under the ring here
const float BASE_ROT = PI / 6.0;   // flat-topped hexagon, like the icon

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

float gEps;   // one device pixel, in logo units (set per frame in main)

// Signed distance to the opening's edge (negative inside the opening).
float openingSdf(vec2 q) {
  float r = length(q);
  float a = atan(q.y, q.x) - uRot - BASE_ROT;
  float hex = r * cos(a - SEG * floor(a / SEG + 0.5)) - uAp;
  return max(hex, r - RING_IN);
}

// One blade's surface: it rises as it comes out from under the blade above
// (sAbove <= 0 is the distance from that seam) and rounds over at its own
// leading edge (sOwn >= 0 is the distance back from it).
float bladeZ(float sOwn, float sAbove) {
  float z = 0.016 + 0.034 * smoothstep(0.0, 0.30, -sAbove);
  float e = 1.0 - clamp(sOwn / 0.03, 0.0, 1.0);
  return z - 0.016 * (1.0 - sqrt(max(0.0, 1.0 - e * e)));
}

// Heavy rounded rim on a flat band carrying six pivot rivets.
float ringZ(vec2 q, float r) {
  float z = 0.072;
  float x = (r - 0.9425) / 0.0575;
  if (r > 0.9425) z = 0.1295 * sqrt(max(0.0, 1.0 - x * x));
  else if (r > 0.885) z = 0.072 + 0.0575 * sqrt(max(0.0, 1.0 - x * x));
  float e = 1.0 - clamp((max(r, RING_IN) - RING_IN) / 0.022, 0.0, 1.0);
  z -= 0.016 * (1.0 - sqrt(max(0.0, 1.0 - e * e)));   // inner lip rolls over the blades
  float a = atan(q.y, q.x) - BASE_ROT;
  float fa = a - SEG * floor(a / SEG + 0.5);
  float d = length(r * vec2(cos(fa), sin(fa)) - vec2(0.842, 0.0));
  if (d < 0.021) z = max(z, 0.072 + sqrt(0.021 * 0.021 - d * d));
  return z;
}

// Height in logo units. mat: 0 background, 1 ring, 2 blade, 3 opening.
// Every junction (seam, leading edge, ring lip) is blended across one device
// pixel so the shading stays anti-aliased on 1x screens.
float heightAt(vec2 q, out float mat, out float crease) {
  crease = 1.0;
  float r = length(q);
  if (r >= 1.0) { mat = 0.0; return 0.0; }

  float zInner = 0.0;
  bool opening = openingSdf(q) < 0.0;
  if (!opening && r < RING_IN + gEps) {
    // Each blade covers the half-plane beyond its edge line. The visible one
    // is the first in clockwise order that reaches this point; it tucks under
    // the blade before it and lies over the blade after it.
    float a = atan(q.y, q.x) - uRot - BASE_ROT;
    float g = acos(clamp(uAp / max(r, 1e-5), -1.0, 1.0));
    float th = SEG * ceil((a - g) / SEG);
    float sTop = r * cos(th - a) - uAp;
    float sAbove = r * cos(th - SEG - a) - uAp;
    float sAbove2 = r * cos(th - 2.0 * SEG - a) - uAp;
    float sBelow = r * cos(th + SEG - a) - uAp;
    zInner = bladeZ(sTop, sAbove);
    zInner = mix(zInner, bladeZ(sAbove, sAbove2), smoothstep(-gEps, gEps, sAbove));
    float zUnder = sBelow > 0.0 ? bladeZ(sBelow, sTop) : 0.0;
    zInner = mix(zInner, zUnder, smoothstep(gEps, -gEps, sTop));
    crease = mix(0.5, 1.0, smoothstep(0.0, 0.06, -sAbove));
  }

  if (r <= RING_IN - gEps) {
    mat = opening ? 3.0 : 2.0;
    return zInner;
  }
  mat = r < RING_IN ? (opening ? 3.0 : 2.0) : 1.0;
  return mix(zInner, ringZ(q, r), smoothstep(RING_IN - gEps, RING_IN + gEps, r));
}

void main() {
  vec2 fc = gl_FragCoord.xy;
  vec2 pc = vec2(fc.x, uRes.y - fc.y) / uScale;
  vec2 s = (pc - uCenter) / uR;

  // Perspective: the logo plane is tipped back by uTilt (focal length F).
  const float F = 3.2;
  float ct = cos(uTilt), st = sin(uTilt);
  float den = F * ct + s.y * st;
  vec2 q = den > 0.2 ? vec2(0.0, s.y * F / den) : vec2(0.0, -1e4);
  q.x = s.x * (F - q.y * st) / F;

  // Light and view in the plane's own frame.
  vec3 L = normalize(vec3(uL.x, ct * uL.y + st * uL.z, -st * uL.y + ct * uL.z));
  vec3 V = vec3(0.0, st, ct);

  float eps = 1.0 / (uScale * uR);
  gEps = eps;
  float mat, crease, m, c;
  float z0 = heightAt(q, mat, crease);
  float zx = heightAt(q + vec2(eps, 0.0), m, c) - heightAt(q - vec2(eps, 0.0), m, c);
  float zy = heightAt(q + vec2(0.0, eps), m, c) - heightAt(q - vec2(0.0, eps), m, c);
  vec3 n = normalize(vec3(-zx / (2.0 * eps), -zy / (2.0 * eps), 1.0));

  // Soft shadows across the carving and onto the background.
  vec2 Ld = normalize(L.xy);
  float tanE = L.z / max(length(L.xy), 1e-4);
  float sh = 1.0;
  float jit = hash12(fc + 7.0);
  for (int i = 0; i < 9; i++) {
    float t = 0.006 * pow(float(i) + 0.5 + jit, 1.7);
    sh = min(sh, 7.0 * (z0 + t * tanE - heightAt(q + Ld * t, m, c)) / t);
  }
  sh = smoothstep(0.0, 1.0, sh);

  float r = length(q);
  float ao = crease;
  if (mat == 2.0) ao *= mix(0.62, 1.0, smoothstep(RING_IN, RING_IN - 0.07, r));  // under the ring lip
  if (mat == 0.0) ao *= mix(0.74, 1.0, smoothstep(1.0, 1.16, r));                // contact shade around the rim

  float grain = 0.55 * vnoise(q * 9.0) + 0.3 * vnoise(q * 27.0) + 0.15 * vnoise(q * 71.0);
  vec3 alb = mix(uStoneA, uStoneB, mat == 2.0 ? 0.6 : 0.1) * (0.9 + 0.2 * (grain - 0.5));

  float ndl = max(dot(n, L), 0.0);
  vec3 hemi = mix(uGround, uSky, 0.5 - 0.5 * n.y);
  float spec = uSpec * pow(max(dot(n, normalize(L + V)), 0.0), uShine) * sh;
  vec3 logo = alb * (uLightCol * ndl * sh + hemi * ao) + uLightCol * spec;

  vec3 bg = uBg * mix(1.0, 0.82, (1.0 - sh) * uFade) * mix(1.0, ao, uFade);
  vec2 uv = fc / uRes;
  bg *= 1.0 - 0.16 * pow(clamp(length(uv - 0.5) * 1.35, 0.0, 1.0), 2.4);

  // The opening starts as a black pupil (fading in with the logo) and turns
  // see-through as the iris widens, so the app floods in like light.
  vec3 col = mat == 0.0 ? bg : mix(bg, logo, uFade);
  float hole = 1.0 - smoothstep(-eps, eps, openingSdf(q));
  col = mix(col, bg * (1.0 - uFade), hole);
  col = pow(max(col, 0.0), vec3(1.0 / 2.2));
  col = max(col + (hash12(fc + 0.37) - 0.5) / 255.0, 0.0);
  float alpha = 1.0 - hole * smoothstep(0.10, 0.34, uAp);
  fragColor = vec4(col * alpha, alpha);   // premultiplied
}`;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const span = (t, a, b) => clamp01((t - a) / (b - a));
const outCubic = (x) => 1 - (1 - x) ** 3;
const inPow = (x) => x ** 2.2;
const inOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

/** Total length of the intro, in seconds. */
export const INTRO_SECONDS = 1.85;

/**
 * Where the animation is at `time` seconds, for a CSS viewport size.
 *   0.00–0.90  logo fades in and swings up from a 32° tilt to face the viewer
 *   0.00–1.30  light sweeps across the stone
 *   0.65–1.25  the iris opens from a black pupil, blades turning as they retract
 *   0.95–1.85  fly-through: the opening grows past the screen edges
 */
export function introFrame(time, width, height) {
  const r0 = Math.min(190, Math.max(80, 0.22 * Math.min(width, height)));
  const halfDiag = 0.5 * Math.hypot(width, height);
  const endScale = (1.04 * halfDiag) / (0.8 * r0); // the ring's inner edge clears the screen corners
  const fade = outCubic(span(time, 0, 0.35));
  const open = inOutCubic(span(time, 0.65, 1.25));
  const zoom = inPow(span(time, 0.95, INTRO_SECONDS));
  return {
    radius: r0 * (0.94 + 0.06 * fade) * Math.exp(Math.log(endScale) * zoom),
    tilt: 0.55 * (1 - inOutCubic(span(time, 0, 0.9))),
    aperture: 0.05 + 0.77 * open,
    rotation: -0.62 * open,
    fade,
    sweep: inOutCubic(span(time, 0, 1.3)),
  };
}

/* ------------------------------------------------------------------ */

function linHex(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => {
    const x = c / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
}

/**
 * Renderer bound to `canvas`, or null without WebGL2. `preset` is a
 * cathedral lighting preset, so the logo is lit like the facade behind it;
 * `exposure` lifts it for night mode, where the moonlight is dim.
 */
export function createApertureIntro(canvas) {
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "low-power",
  });
  if (!gl) return null;

  const compile = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(`Intro shader failed to compile: ${gl.getShaderInfoLog(sh)}`);
    }
    return sh;
  };
  let prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, INTRO_VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, INTRO_FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`Intro program failed to link: ${gl.getProgramInfoLog(prog)}`);
    }
  } catch (err) {
    console.warn(err.message);
    return null;
  }

  const loc = {};
  const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const { name } = gl.getActiveUniform(prog, i);
    loc[name] = gl.getUniformLocation(prog, name);
  }
  const vao = gl.createVertexArray();

  return {
    /** Draw the frame at `time` seconds. Returns false if the context is gone. */
    render({ width, height, scale, time, preset, bg, exposure = 1 }) {
      if (gl.isContextLost()) return false;
      const w = Math.max(1, Math.floor(width * scale));
      const h = Math.max(1, Math.floor(height * scale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const f = introFrame(time, width, height);

      // The light starts further round and sweeps to the facade's angle.
      const [lx, ly, lz] = preset.light;
      const el = Math.asin(lz);
      const az = Math.atan2(ly, lx) + (1 - f.sweep) * 0.62;
      const light = [Math.cos(az) * Math.cos(el), -Math.sin(az) * Math.cos(el), Math.sin(el)];
      const k = (v, m) => v.map((x) => x * m);

      gl.viewport(0, 0, w, h);
      gl.useProgram(prog);
      gl.uniform2f(loc.uRes, w, h);
      gl.uniform1f(loc.uScale, w / width);
      gl.uniform2f(loc.uCenter, width / 2, height / 2);
      gl.uniform1f(loc.uR, f.radius);
      gl.uniform1f(loc.uTilt, f.tilt);
      gl.uniform1f(loc.uAp, f.aperture);
      gl.uniform1f(loc.uRot, f.rotation);
      gl.uniform1f(loc.uFade, f.fade);
      gl.uniform3fv(loc.uL, light);
      gl.uniform3fv(loc.uLightCol, k(preset.lightCol, exposure));
      gl.uniform3fv(loc.uSky, k(preset.sky, exposure));
      gl.uniform3fv(loc.uGround, k(preset.ground, exposure));
      gl.uniform3fv(loc.uStoneA, preset.stoneA);
      gl.uniform3fv(loc.uStoneB, preset.stoneB);
      gl.uniform3fv(loc.uBg, linHex(bg));
      gl.uniform1f(loc.uSpec, preset.spec);
      gl.uniform1f(loc.uShine, preset.shine);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return true;
    },
    /** Free GPU resources; `lose` also releases the context itself. */
    dispose({ lose = false } = {}) {
      gl.deleteVertexArray(vao);
      gl.deleteProgram(prog);
      if (lose) gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
