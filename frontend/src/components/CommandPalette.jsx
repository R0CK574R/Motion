import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, Search } from "lucide-react";

/**
 * Cmd+K / Ctrl+K: every action on the page, reachable from the keyboard.
 *
 * `commands` is a list of { id, group, label, hint?, run }. Typing filters
 * it; if `onAsk` is given, whatever was typed can also be sent as a question
 * to "ask your portfolio".
 */
export default function CommandPalette({ open, onClose, commands, onAsk, t }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const returnFocusTo = useRef(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? commands.filter((c) => `${c.group} ${c.label}`.toLowerCase().includes(q))
      : commands;
    if (q && onAsk) {
      return [
        ...matches,
        { id: "ask-typed", group: "Ask", label: `Ask: “${query.trim()}”`, run: () => onAsk(query.trim()) },
      ];
    }
    return matches;
  }, [query, commands, onAsk]);

  // Runs before the browser paints, so the palette opens empty and focused:
  // a key typed straight after Ctrl+K lands here, not in whatever field had
  // focus, and never on top of the previous search.
  useLayoutEffect(() => {
    if (!open) return undefined;
    returnFocusTo.current = document.activeElement;
    setQuery("");
    setActive(0);
    inputRef.current?.focus();
    return () => returnFocusTo.current?.focus?.();
  }, [open]);

  useEffect(() => { setActive(0); }, [query]);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  function run(command) {
    onClose();
    // Let the palette close and focus return before the command moves it again.
    setTimeout(() => command.run(), 0);
  }

  function onKeyDown(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[active]) run(results[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Tab") {
      e.preventDefault(); // the input is the only stop inside the dialog
    }
  }

  let lastGroup = null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[14vh]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className={`w-full max-w-lg overflow-hidden rounded-lg border ${t.card}`}
      >
        <div className={`flex items-center gap-3 border-b px-4 ${t.rule}`}>
          <Search className={`h-4 w-4 shrink-0 ${t.faint}`} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls="command-list"
            aria-activedescendant={results[active] ? `command-${results[active].id}` : undefined}
            aria-label="Search commands"
            placeholder={onAsk ? "Type a command, or a question about your portfolio" : "Type a command"}
            className={`w-full bg-transparent py-3.5 text-sm outline-none placeholder:opacity-60 ${t.body}`}
            style={{ outline: "none" }}
          />
        </div>

        <ul id="command-list" ref={listRef} role="listbox" aria-label="Commands"
          className="max-h-[50vh] overflow-y-auto p-1.5">
          {results.length === 0 && (
            <li className={`px-3 py-6 text-center text-sm ${t.muted}`}>No command matches “{query}”.</li>
          )}
          {results.map((c, i) => {
            const heading = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <React.Fragment key={c.id}>
                {heading && (
                  <li role="presentation" className={`label px-3 pb-1 pt-2.5 ${t.faint}`}>{heading}</li>
                )}
                <li
                  id={`command-${c.id}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => setActive(i)}
                  onMouseDown={(e) => { e.preventDefault(); run(c); }}
                  className={`flex cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2 text-sm ${
                    i === active ? t.toggleActive : t.body
                  }`}
                >
                  <span className="truncate">{c.label}</span>
                  {i === active ? (
                    <CornerDownLeft className="h-3.5 w-3.5 shrink-0 opacity-70" />
                  ) : (
                    c.hint && <span className={`shrink-0 text-xs ${t.faint}`}>{c.hint}</span>
                  )}
                </li>
              </React.Fragment>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
