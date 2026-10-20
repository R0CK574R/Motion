/**
 * Gothic tracery geometry: rose window, lancet window, quatrefoil lattice.
 *
 * Pure functions that return SVG path data — no React, no DOM. Shapes are
 * built the way medieval masons laid out tracery: circles, compass arcs, and
 * rotational symmetry. Everything is computed once at import time and drawn by
 * components/Backdrop.jsx.
 */

const TAU = Math.PI * 2;
const n = (v) => Math.round(v * 100) / 100; // keeps path strings short

const polar = (cx, cy, r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];

export function circle(cx, cy, r) {
  return (
    `M${n(cx + r)} ${n(cy)}` +
    `A${n(r)} ${n(r)} 0 1 0 ${n(cx - r)} ${n(cy)}` +
    `A${n(r)} ${n(r)} 0 1 0 ${n(cx + r)} ${n(cy)}Z`
  );
}

function line(x1, y1, x2, y2) {
  return `M${n(x1)} ${n(y1)}L${n(x2)} ${n(y2)}`;
}

/**
 * A foil — trefoil (3 lobes), quatrefoil (4), sexfoil (6). `lobes` circles of
 * radius `r` sit `d` from the centre and are traced as one outline, with the
 * cusps between lobes pointing inward. `rot` is the first lobe's angle.
 */
export function foil(cx, cy, lobes, d, r, rot = -Math.PI / 2) {
  const half = Math.PI / lobes;
  const halfChord = d * Math.sin(half);
  if (r <= halfChord) {
    throw new Error("foil lobes must overlap: need r > d·sin(π/lobes)");
  }
  const cuspR = d * Math.cos(half) + Math.sqrt(r * r - halfChord * halfChord);

  let path = "";
  for (let k = 0; k < lobes; k++) {
    const a = rot + (TAU * k) / lobes;
    const [lx, ly] = polar(cx, cy, d, a);
    const [sx, sy] = polar(cx, cy, cuspR, a - half);
    const [ex, ey] = polar(cx, cy, cuspR, a + half);
    let span = Math.atan2(ey - ly, ex - lx) - Math.atan2(sy - ly, sx - lx);
    while (span <= 0) span += TAU;
    if (k === 0) path += `M${n(sx)} ${n(sy)}`;
    path += `A${n(r)} ${n(r)} 0 ${span > Math.PI ? 1 : 0} 1 ${n(ex)} ${n(ey)}`;
  }
  return path + "Z";
}

/**
 * Pointed arch springing from (x1, y) to (x2, y). rho = span is the classic
 * equilateral Gothic arch; rho = span / 2 would be a round Roman arch.
 * Returns the two arcs (no leading M) and the apex height.
 */
function archArcs(x1, x2, y, rho) {
  const half = (x2 - x1) / 2;
  const h = Math.sqrt(rho * rho - (rho - half) * (rho - half));
  const mid = x1 + half;
  return {
    arcs:
      `A${n(rho)} ${n(rho)} 0 0 1 ${n(mid)} ${n(y - h)}` +
      `A${n(rho)} ${n(rho)} 0 0 1 ${n(x2)} ${n(y)}`,
    apexY: y - h,
  };
}

/**
 * A pointed arch laid around a circle: springers at radius `rs`, angles
 * θ ± δ, apex pointing outward. Built as an upright arch in a local frame and
 * rotated into place — rotation preserves orientation, so the sweep flags of
 * the upright arch stay valid.
 */
function radialArch(rs, theta, delta, rhoFactor) {
  const s = rs * Math.sin(delta);
  const rho = rhoFactor * s;
  const h = Math.sqrt(rho * rho - (rho - s) * (rho - s));
  const m = rs * Math.cos(delta);
  const [s1x, s1y] = polar(0, 0, rs, theta - delta);
  const [s2x, s2y] = polar(0, 0, rs, theta + delta);
  const [ax, ay] = polar(0, 0, m + h, theta);
  return (
    `M${n(s1x)} ${n(s1y)}` +
    `A${n(rho)} ${n(rho)} 0 0 1 ${n(ax)} ${n(ay)}` +
    `A${n(rho)} ${n(rho)} 0 0 1 ${n(s2x)} ${n(s2y)}`
  );
}

/** Lens-shaped petal (vesica) between radii r1 and r2 along angle θ. */
function petal(theta, r1, r2, sagitta) {
  const [x1, y1] = polar(0, 0, r1, theta);
  const [x2, y2] = polar(0, 0, r2, theta);
  const chord = r2 - r1;
  const rho = (sagitta * sagitta + (chord / 2) ** 2) / (2 * sagitta);
  return (
    `M${n(x1)} ${n(y1)}` +
    `A${n(rho)} ${n(rho)} 0 0 1 ${n(x2)} ${n(y2)}` +
    `A${n(rho)} ${n(rho)} 0 0 1 ${n(x1)} ${n(y1)}Z`
  );
}

/* ------------------------------------------------------------------ *
 * Rose window — viewBox "-500 -500 1000 1000", 12/24-fold symmetry.
 *
 *   hub sexfoil → 12 petals → roundel ring (12 quatrefoils) →
 *   24 pointed lights with trefoil heads → beaded outer molding
 * ------------------------------------------------------------------ */
export const ROSE_VIEWBOX = "-500 -500 1000 1000";

export function roseWindow() {
  const heavy = [];
  const main = [];
  const fine = [];
  const glass = [];
  const step12 = TAU / 12;
  const step24 = TAU / 24;

  // Moldings, outside in.
  heavy.push(circle(0, 0, 486), circle(0, 0, 470));
  for (let k = 0; k < 96; k++) {
    const [x, y] = polar(0, 0, 478, (TAU * k) / 96);
    fine.push(circle(x, y, 4.2));
  }

  // Outer ring: 24 pointed lights. Mullions on multiples of 15° continue the
  // inner spokes; each light carries a trefoil in its head.
  main.push(circle(0, 0, 362));
  heavy.push(circle(0, 0, 352));
  for (let k = 0; k < 24; k++) {
    const mullion = k * step24;
    main.push(line(...polar(0, 0, 362, mullion), ...polar(0, 0, 470, mullion)));
    const centre = mullion + step24 / 2;
    main.push(radialArch(382, centre, step24 / 2, 1.65));
    const t = foil(...polar(0, 0, 416, centre), 3, 9, 10.5, centre);
    fine.push(t);
    glass.push(t);
  }

  // Middle ring: 12 roundels, each holding a quatrefoil, with spokes between.
  heavy.push(circle(0, 0, 188));
  main.push(circle(0, 0, 180));
  for (let k = 0; k < 12; k++) {
    const a = k * step12;
    const [cx, cy] = polar(0, 0, 270, a);
    main.push(circle(cx, cy, 60));
    fine.push(circle(cx, cy, 54));
    const q = foil(cx, cy, 4, 23, 21, a);
    fine.push(q);
    glass.push(q);
    const spoke = a + step12 / 2;
    main.push(line(...polar(0, 0, 188, spoke), ...polar(0, 0, 352, spoke)));
  }

  // Inner flower: 12 large petals with 12 smaller ones between them.
  for (let k = 0; k < 12; k++) {
    const big = petal(k * step12, 64, 176, 20);
    const small = petal(k * step12 + step12 / 2, 118, 176, 9);
    main.push(big);
    fine.push(small);
    glass.push(big, small);
  }

  // Hub.
  main.push(circle(0, 0, 64));
  fine.push(circle(0, 0, 58), circle(0, 0, 9));
  const hub = foil(0, 0, 6, 26, 21);
  fine.push(hub);
  glass.push(hub);

  return {
    heavy: heavy.join(""),
    main: main.join(""),
    fine: fine.join(""),
    glass: glass.join(""),
  };
}

/* ------------------------------------------------------------------ *
 * Lancet window — viewBox "0 0 240 640".
 *
 *   equilateral arch → two sub-lights with trefoil heads →
 *   sexfoil roundel in the head → iron saddle bars
 * ------------------------------------------------------------------ */
export const LANCET_VIEWBOX = "0 0 240 640";

export function lancetWindow() {
  const outer = archArcs(0, 240, 215, 240);
  const inner = archArcs(12, 228, 215, 216);
  const left = archArcs(12, 120, 330, 108);
  const right = archArcs(120, 228, 330, 108);

  const heavy = `M0 640L0 215${outer.arcs}L240 640Z`;
  const main = [
    `M12 628L12 215${inner.arcs}L228 628Z`,
    "M120 628L120 330",
    `M12 330${left.arcs}`,
    `M120 330${right.arcs}`,
    circle(120, 138, 70),
  ].join("");

  const sexfoil = foil(120, 138, 6, 30, 24);
  const trefoilL = foil(66, 282, 3, 11, 12.5);
  const trefoilR = foil(174, 282, 3, 11, 12.5);
  const fine = [
    circle(120, 138, 63),
    circle(120, 138, 8),
    sexfoil,
    trefoilL,
    trefoilR,
    "M12 400L228 400M12 470L228 470M12 540L228 540",
  ].join("");

  return {
    heavy,
    main,
    fine,
    glass: [sexfoil, trefoilL, trefoilR].join(""),
  };
}

/* ------------------------------------------------------------------ *
 * Quatrefoil diaper — the lattice carved into Gothic wall panels.
 * One 56×56 tile; quatrefoils sit on tile edges so neighbours complete them.
 * ------------------------------------------------------------------ */
export const LATTICE_TILE = 56;

export function latticeTile() {
  const s = LATTICE_TILE;
  const h = s / 2;
  return [
    `M0 0L${s} ${s}M${s} 0L0 ${s}`,
    foil(h, 0, 4, 7, 7.6, 0),
    foil(h, s, 4, 7, 7.6, 0),
    foil(0, h, 4, 7, 7.6, 0),
    foil(s, h, 4, 7, 7.6, 0),
    circle(0, 0, 1.8),
    circle(s, 0, 1.8),
    circle(0, s, 1.8),
    circle(s, s, 1.8),
    circle(h, h, 1.8),
  ].join("");
}
