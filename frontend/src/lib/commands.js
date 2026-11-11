/**
 * A tiny message bus so the command palette can ask other parts of the page
 * to do something ("focus the buy form", "write the memo") without those
 * parts knowing the palette exists.
 */
const listeners = new Map(); // event name -> Set of handlers
const waiting = new Map(); // event name -> { detail, at } with nobody listening yet

// A command can fire before the part of the page that handles it has loaded
// (asking a question the moment the dashboard appears, for example). Such an
// event is held briefly and delivered to the first subscriber.
const HOLD_MS = 15000;

export function emit(name, detail) {
  const handlers = listeners.get(name);
  if (handlers && handlers.size > 0) {
    handlers.forEach((handler) => handler(detail));
  } else {
    waiting.set(name, { detail, at: Date.now() });
  }
}

/** Subscribes; returns the function that unsubscribes. */
export function on(name, handler) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(handler);

  const held = waiting.get(name);
  if (held) {
    waiting.delete(name);
    if (Date.now() - held.at < HOLD_MS) {
      // After the current render, when the subscriber is ready to act.
      setTimeout(() => handler(held.detail), 0);
    }
  }
  return () => listeners.get(name)?.delete(handler);
}

/** Scrolls a section into view and moves keyboard focus to it. */
export function goTo(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  el.focus({ preventScroll: true });
}
