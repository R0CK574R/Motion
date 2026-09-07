import React from "react";
import { Sun, Moon, Clock } from "lucide-react";

export function ThemeToggle({ mode, setMode, resolved, t }) {
  const options = [
    { key: "auto", Icon: Clock, label: `Auto — currently ${resolved}` },
    { key: "light", Icon: Sun, label: "Light" },
    { key: "dark", Icon: Moon, label: "Dark" },
  ];
  return (
    <div
      className={`flex rounded-lg border p-0.5 transition-colors duration-500 ${t.toggleShell}`}
    >
      {options.map(({ key, Icon, label }) => (
        <button
          key={key}
          onClick={() => setMode(key)}
          title={label}
          aria-label={label}
          aria-pressed={mode === key}
          className={`rounded-md p-1.5 transition ${
            mode === key ? t.toggleActive : t.toggleIdle
          }`}
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  );
}

export function StatTile({ label, value, tone, t }) {
  return (
    <div className={`rounded-xl border p-4 transition-colors duration-500 ${t.card}`}>
      <div className={`text-xs uppercase tracking-wide ${t.faint}`}>{label}</div>
      <div className={`mt-1 font-mono text-lg font-semibold tabular-nums ${tone}`}>
        {value}
      </div>
    </div>
  );
}
