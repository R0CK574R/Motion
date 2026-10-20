import React, { useEffect, useId, useRef, useState } from "react";
import { createCathedral, CATHEDRAL_PRESETS } from "../lib/cathedral.js";
import {
  roseWindow,
  ROSE_VIEWBOX,
  lancetWindow,
  LANCET_VIEWBOX,
  latticeTile,
  LATTICE_TILE,
} from "../lib/ornament.js";

// The facade is computed at up to 2× the CSS size and filtered down to the
// screen, so 1× monitors get supersampled edges and Retina screens get full
// resolution. Very large displays scale the internal size down to stay inside
// the pixel budget rather than spend GPU time on detail behind the content.
const MAX_SCALE = 2;
const MAX_PIXELS = 5.3e6;
const FADE = "500ms ease";

/* ------------------------------------------------------------------ *
 * Line-art fallback for browsers without WebGL2
 * ------------------------------------------------------------------ */
const ROSE = roseWindow();
const LANCET = lancetWindow();
const TILE = latticeTile();

function Tracery({ shape, glass }) {
  const stroke = { fill: "none", stroke: "currentColor", vectorEffect: "non-scaling-stroke" };
  return (
    <>
      <path d={shape.glass} fill="currentColor" fillOpacity={glass} />
      <path d={shape.heavy} {...stroke} strokeWidth={1.6} />
      <path d={shape.main} {...stroke} strokeWidth={1.1} />
      <path d={shape.fine} {...stroke} strokeWidth={0.75} />
    </>
  );
}

function LineArt({ t }) {
  const o = t.ornament;
  // useId keeps pattern ids unique; colons aren't safe inside url(#…).
  const patternId = `motion-lattice-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const layer = { position: "absolute", transition: `opacity ${FADE}` };
  return (
    <div style={{ position: "absolute", inset: 0, color: o.color, transition: `color ${FADE}` }}>
      <style>{`
        .motion-lancet { display: none; }
        @media (min-width: 1024px) { .motion-lancet { display: block; } }
      `}</style>
      <svg width="100%" height="100%" style={{ ...layer, inset: 0, opacity: o.lattice }}>
        <defs>
          <pattern id={patternId} width={LATTICE_TILE} height={LATTICE_TILE} patternUnits="userSpaceOnUse">
            <path d={TILE} fill="none" stroke="currentColor" strokeWidth={0.8} />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
      <svg
        viewBox={ROSE_VIEWBOX}
        style={{
          ...layer,
          left: "50%",
          top: "50%",
          width: "min(1120px, max(560px, 94vmin))",
          height: "min(1120px, max(560px, 94vmin))",
          transform: "translate(-50%, -50%)",
          opacity: o.rose,
        }}
      >
        <Tracery shape={ROSE} glass={o.glass} />
      </svg>
      {["left", "right"].map((side) => (
        <svg
          key={side}
          className="motion-lancet"
          viewBox={LANCET_VIEWBOX}
          style={{
            ...layer,
            top: "50%",
            [side]: "max(12px, calc((100vw - 1024px) / 4 - 13.875vh))",
            height: "74vh",
            width: "27.75vh",
            transform: "translateY(-50%)",
            opacity: o.lancet,
          }}
        >
          <Tracery shape={LANCET} glass={o.glass} />
        </svg>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Shader backdrop
 * ------------------------------------------------------------------ */

/**
 * Carved-stone cathedral facade behind the whole app (see lib/cathedral.js).
 *
 * Render once at the app root, not per screen: it owns a single WebGL context
 * for the session. It re-renders only when the viewport size or theme changes,
 * and cross-fades between day and night so the switch matches the 500ms
 * colour transition on the rest of the UI. Falls back to line art when
 * WebGL2 is unavailable.
 */
export function Backdrop({ t }) {
  const glRef = useRef(null);
  const snapRef = useRef(null);
  const st = useRef({ renderer: null, preset: null, ready: false, timer: 0 });
  const [mode, setMode] = useState("gl"); // "gl" | "lines"
  const [ready, setReady] = useState(false);
  const preset = CATHEDRAL_PRESETS[t.cathedral];

  // Overscroll areas and native controls follow the theme too.
  useEffect(() => {
    const root = document.documentElement;
    root.style.backgroundColor = t.canvasBg;
    root.style.colorScheme = t.scheme;
  }, [t]);

  // Boot the renderer once; re-render on resize; recover from context loss.
  useEffect(() => {
    const canvas = glRef.current;
    const s = st.current;
    s.preset = preset;

    const draw = () => {
      if (!s.renderer) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const deviceScale = Math.min(window.devicePixelRatio || 1, MAX_SCALE);
      const internalScale = Math.min(MAX_SCALE, Math.sqrt(MAX_PIXELS / (rect.width * rect.height)));
      const res = s.renderer.render({
        width: rect.width,
        height: rect.height,
        deviceScale,
        internalScale,
        preset: s.preset,
      });
      if (res && !s.ready) {
        s.ready = true;
        setReady(true);
      }
    };

    const boot = () => {
      try {
        s.renderer = createCathedral(canvas);
      } catch {
        s.renderer = null;
      }
      if (!s.renderer) {
        setMode("lines");
        return false;
      }
      draw();
      return true;
    };

    s.draw = draw;
    if (!boot()) return undefined;

    const ro = new ResizeObserver(() => {
      clearTimeout(s.timer);
      s.timer = setTimeout(draw, 150);
    });
    ro.observe(canvas);

    const onLost = (e) => {
      e.preventDefault(); // tells the browser we'll restore it
      s.ready = false;
      setReady(false);
    };
    const onRestored = () => {
      s.renderer = null;
      boot();
    };
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);

    return () => {
      ro.disconnect();
      clearTimeout(s.timer);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      s.renderer?.dispose();
      s.renderer = null;
      s.ready = false;
    };
    // Boot exactly once; theme changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme change: snapshot the old frame, re-light, fade the snapshot out.
  useEffect(() => {
    const s = st.current;
    if (!s.renderer || s.preset === preset) {
      s.preset = preset;
      return;
    }
    s.preset = preset;
    const snap = snapRef.current;
    const gl = glRef.current;
    if (s.ready) {
      snap.width = gl.width;
      snap.height = gl.height;
      snap.getContext("2d").drawImage(gl, 0, 0);
      snap.style.transition = "none";
      snap.style.opacity = "1";
    }
    s.draw();
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        snap.style.transition = `opacity ${FADE}`;
        snap.style.opacity = "0";
      })
    );
  }, [preset]);

  const fill = { position: "absolute", inset: 0, width: "100%", height: "100%" };

  return (
    <div
      aria-hidden="true"
      className="motion-backdrop"
      style={{ position: "fixed", left: 0, top: 0, width: "100%", zIndex: 0, overflow: "hidden", pointerEvents: "none" }}
    >
      {/* Large-viewport height keeps the facade still when mobile toolbars slide. */}
      <style>{`.motion-backdrop { height: 100vh; height: 100lvh; }`}</style>
      <div className={`transition-colors duration-500 ${t.pageBg}`} style={fill} />
      {mode === "lines" && <LineArt t={t} />}
      <canvas
        ref={glRef}
        style={{
          ...fill,
          display: mode === "lines" ? "none" : "block",
          objectFit: "cover",
          opacity: ready ? 1 : 0,
          transition: "opacity 700ms ease",
        }}
      />
      <canvas
        ref={snapRef}
        onTransitionEnd={(e) => {
          // Free the snapshot's memory once it has faded out.
          if (e.currentTarget.style.opacity === "0") {
            e.currentTarget.width = 1;
            e.currentTarget.height = 1;
          }
        }}
        style={{ ...fill, objectFit: "cover", opacity: 0 }}
      />
    </div>
  );
}

/**
 * Full-page wrapper used by every screen. Transparent, so the app-level
 * Backdrop shows through; z-index lifts content above it.
 */
export function PageShell({ t, className = "", children }) {
  return (
    <div
      className={`relative min-h-screen font-sans transition-colors duration-500 ${t.pageText} ${className}`}
      style={{ zIndex: 1 }}
    >
      {children}
    </div>
  );
}
