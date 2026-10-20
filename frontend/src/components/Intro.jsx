import React, { useEffect, useRef, useState } from "react";
import { createApertureIntro, INTRO_SECONDS } from "../lib/apertureIntro.js";
import { CATHEDRAL_PRESETS } from "../lib/cathedral.js";

const SEEN_KEY = "motion:intro-seen";
// The intro moves fast, so it renders a little below full Retina resolution.
const INTRO_MAX_SCALE = 1.5;
const INTRO_MAX_PIXELS = 2.6e6;
const SKIP_FADE_MS = 250;

function shouldPlay() {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
  try {
    if (window.sessionStorage.getItem(SEEN_KEY)) return false;
  } catch {
    // Storage blocked (private mode, strict settings): just play it.
  }
  return true;
}

/**
 * First-visit intro: the aperture logo, carved in stone, opens and the view
 * flies through it into the app (see lib/apertureIntro.js).
 *
 * Plays once per browser session. Any click, tap or key skips it. Skipped
 * entirely when the visitor prefers reduced motion or WebGL2 isn't available.
 * Mount once at the app root, above everything else.
 */
export function Intro({ t }) {
  const [active, setActive] = useState(shouldPlay);
  const canvasRef = useRef(null);
  const themeRef = useRef(t);
  themeRef.current = t;

  useEffect(() => {
    if (!active) return undefined;
    const canvas = canvasRef.current;
    let intro = null;
    try {
      intro = createApertureIntro(canvas);
    } catch {
      intro = null;
    }
    if (!intro) {
      setActive(false);
      return undefined;
    }
    try {
      window.sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      // Not remembered across reloads this time; harmless.
    }

    // Theme is fixed for the length of the intro.
    const theme = themeRef.current;
    const preset = CATHEDRAL_PRESETS[theme.cathedral];
    const exposure = theme.scheme === "dark" ? 2.4 : 1;
    let raf = 0;
    let start = 0;
    let first = true;
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      intro.dispose({ lose: true });
      setActive(false);
    };

    const tick = (now) => {
      // Frame 0 is drawn first; the clock starts on the next callback, once
      // it's on screen. If the GPU is still busy with the backdrop, the intro
      // waits on its first frame instead of skipping ahead.
      if (!first && !start) start = now;
      const time = start ? (now - start) / 1000 : 0;
      const rect = canvas.getBoundingClientRect();
      const scale = Math.min(
        window.devicePixelRatio || 1,
        INTRO_MAX_SCALE,
        Math.sqrt(INTRO_MAX_PIXELS / Math.max(1, rect.width * rect.height))
      );
      const ok = intro.render({
        width: rect.width,
        height: rect.height,
        scale,
        time: Math.min(time, INTRO_SECONDS),
        preset,
        bg: theme.canvasBg,
        exposure,
      });
      if (first) {
        // The CSS background hides the app until the first frame lands; after
        // that the canvas itself is opaque except where the iris is open.
        first = false;
        canvas.style.background = "transparent";
      }
      if (!ok || time >= INTRO_SECONDS) {
        finish();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const skip = () => {
      if (finished) return;
      cancelAnimationFrame(raf); // hold the current frame while it fades
      canvas.style.transition = `opacity ${SKIP_FADE_MS}ms ease`;
      canvas.style.opacity = "0";
      setTimeout(finish, SKIP_FADE_MS);
    };
    window.addEventListener("keydown", skip);
    canvas.addEventListener("pointerdown", skip);

    return () => {
      window.removeEventListener("keydown", skip);
      canvas.removeEventListener("pointerdown", skip);
      cancelAnimationFrame(raf);
      // Dev-mode remounts reuse the canvas, so keep the context alive here;
      // finish() releases it when the intro actually ends.
      if (!finished) intro.dispose();
    };
  }, [active]);

  if (!active) return null;
  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      title="Click to skip"
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        zIndex: 60,
        cursor: "pointer",
        background: t.canvasBg,
      }}
    />
  );
}
