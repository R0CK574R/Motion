import { useState, useEffect } from "react";

/* ------------------------------------------------------------------ *
 * Theme tokens
 *
 * Every color in the UI resolves through one of these semantic keys.
 * Adding or retuning a theme means editing this object only — no color
 * classes are hardcoded in the markup.
 * ------------------------------------------------------------------ */
export const THEMES = {
  light: {
    pageText: "text-neutral-900",
    pageBg: "bg-gradient-to-b from-neutral-50 to-neutral-100",
    canvasBg: "#f5f5f5",
    scheme: "light",
    // Shader preset in lib/cathedral.js: morning sun on pale limestone.
    cathedral: "light",
    // Cards float in front of the carved wall; plaques are frosted glass for
    // text that would otherwise sit directly on the stone.
    card: "border-neutral-200 bg-white shadow-[0_14px_34px_-16px_rgba(0,0,0,0.38)]",
    cardDashed: "border-neutral-300 bg-white shadow-[0_14px_34px_-16px_rgba(0,0,0,0.38)]",
    plaque: "border-white/70 bg-white/90 backdrop-blur-md shadow-[0_14px_34px_-16px_rgba(0,0,0,0.38)]",
    // Secondary text on a plaque: one step darker than `muted`, because the
    // frosted glass can pick up the black window openings behind it.
    plaqueMuted: "text-neutral-600",
    input:
      "border-neutral-200 bg-white text-neutral-900 focus:border-neutral-400 focus:ring-neutral-200",
    logo: "bg-neutral-900 text-white",
    heading: "text-neutral-800",
    body: "text-neutral-700",
    muted: "text-neutral-500",
    faint: "text-neutral-400",
    primaryBtn: "bg-neutral-900 text-white hover:bg-neutral-800",
    ghostBtn:
      "border-neutral-200 text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900",
    toggleShell: "border-neutral-200",
    toggleActive: "bg-neutral-900 text-white",
    toggleIdle: "text-neutral-500 hover:text-neutral-900",
    toggleLocked: "text-neutral-300",
    barTrack: "bg-neutral-100",
    barFill: "bg-neutral-800",
    bullet: "bg-neutral-400",
    up: "text-emerald-600",
    down: "text-rose-600",
    deleteIdle: "text-neutral-300 hover:text-rose-500",
    demoBadge: "border-amber-300 bg-amber-50 text-amber-700",
    riskCard: "border-amber-200 bg-amber-50",
    riskHead: "text-amber-800",
    riskText: "text-amber-900",
    riskDot: "bg-amber-500",
    errorBox: "border-rose-200 bg-rose-50 text-rose-700",
    note: "border-neutral-200 bg-neutral-100 text-neutral-500",
    placeholder: "#a3a3a3",
    // Line-art fallback for browsers without WebGL2: one ink colour, opacity
    // per layer.
    ornament: { color: "#262626", rose: 0.09, lancet: 0.08, lattice: 0.06, glass: 0.3 },
    chart: {
      stroke: "#ffffff",
      tooltipBg: "#ffffff",
      tooltipBorder: "#e5e5e5",
      tooltipText: "#404040",
      cash: "#94a3b8",
      other: "#cbd5e1",
    },
  },
  dark: {
    pageText: "text-neutral-200",
    pageBg: "bg-gradient-to-b from-neutral-900 to-neutral-950",
    canvasBg: "#0d0d0d",
    scheme: "dark",
    // Shader preset: moonlit silver tracery against dark glass.
    cathedral: "dark",
    card: "border-neutral-800 bg-neutral-900 shadow-[0_16px_40px_-14px_rgba(0,0,0,0.9)]",
    cardDashed: "border-neutral-700 bg-neutral-900 shadow-[0_16px_40px_-14px_rgba(0,0,0,0.9)]",
    plaque: "border-neutral-700/60 bg-neutral-900/75 backdrop-blur-md shadow-[0_16px_40px_-14px_rgba(0,0,0,0.9)]",
    plaqueMuted: "text-neutral-400",
    input:
      "border-neutral-800 bg-neutral-950 text-neutral-100 focus:border-neutral-600 focus:ring-neutral-700",
    logo: "bg-neutral-100 text-neutral-950",
    heading: "text-neutral-200",
    body: "text-neutral-200",
    muted: "text-neutral-400",
    faint: "text-neutral-500",
    primaryBtn: "bg-neutral-100 text-neutral-950 hover:bg-white",
    ghostBtn:
      "border-neutral-800 text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100",
    toggleShell: "border-neutral-800",
    toggleActive: "bg-neutral-100 text-neutral-950",
    toggleIdle: "text-neutral-400 hover:text-neutral-100",
    toggleLocked: "text-neutral-600",
    barTrack: "bg-neutral-800",
    barFill: "bg-neutral-100",
    bullet: "bg-neutral-500",
    up: "text-emerald-400",
    down: "text-rose-400",
    deleteIdle: "text-neutral-600 hover:text-rose-400",
    demoBadge: "border-amber-800 bg-amber-950 text-amber-400",
    riskCard: "border-amber-900 bg-neutral-900",
    riskHead: "text-amber-400",
    riskText: "text-amber-100",
    riskDot: "bg-amber-500",
    errorBox: "border-rose-900 bg-neutral-900 text-rose-300",
    note: "border-neutral-800 bg-neutral-900 text-neutral-400",
    placeholder: "#525252",
    ornament: { color: "#e5e5e5", rose: 0.075, lancet: 0.065, lattice: 0.05, glass: 0.3 },
    chart: {
      stroke: "#171717",
      tooltipBg: "#171717",
      tooltipBorder: "#262626",
      tooltipText: "#e5e5e5",
      cash: "#94a3b8",
      other: "#525252",
    },
  },
};

/* ------------------------------------------------------------------ *
 * Adaptive theme: light during the day, dark at night, user can override
 * ------------------------------------------------------------------ */
const DAY_START_HOUR = 7; // 07:00 — switch to light
const DAY_END_HOUR = 19; // 19:00 — switch to dark

const resolveByClock = (date = new Date()) => {
  const hour = date.getHours();
  return hour >= DAY_START_HOUR && hour < DAY_END_HOUR ? "light" : "dark";
};

export function useAdaptiveTheme() {
  // "auto" follows the clock; "light"/"dark" are explicit user overrides.
  const [mode, setMode] = useState("auto");
  const [clockTheme, setClockTheme] = useState(() => resolveByClock());

  useEffect(() => {
    if (mode !== "auto") return undefined;
    // Re-check on the minute so the theme flips live at dawn/dusk without
    // needing a reload.
    setClockTheme(resolveByClock());
    const id = setInterval(() => setClockTheme(resolveByClock()), 60_000);
    return () => clearInterval(id);
  }, [mode]);

  const resolved = mode === "auto" ? clockTheme : mode;
  return { mode, setMode, resolved, t: THEMES[resolved] };
}
