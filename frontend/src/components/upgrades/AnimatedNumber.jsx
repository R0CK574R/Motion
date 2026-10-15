import React, { useEffect, useRef, useState } from "react";

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Tween a number toward `target` with an ease-out curve. If the target changes
 * mid-flight, the next tween starts from the value currently on screen, so
 * rapid edits (typing a price) glide instead of jumping.
 */
export function useCountUp(target, { duration = 700 } = {}) {
  const [value, setValue] = useState(target);
  const shownRef = useRef(target);

  useEffect(() => {
    const from = shownRef.current;
    if (prefersReducedMotion() || from === target || !Number.isFinite(target)) {
      shownRef.current = target;
      setValue(target);
      return undefined;
    }

    let raf;
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = from + (target - from) * eased;
      shownRef.current = v;
      setValue(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
}

export function AnimatedNumber({ value, format = String, className = "" }) {
  const shown = useCountUp(value);
  return <span className={`tabular-nums ${className}`}>{format(shown)}</span>;
}
