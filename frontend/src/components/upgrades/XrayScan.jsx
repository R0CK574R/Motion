import React from "react";
import "./upgrades.css";

/**
 * Wrap any card. While `active`, a glowing scan line sweeps over it on a faint
 * grid — a literal "X-ray" while /api/analysis is in flight, instead of a
 * spinner on the button.
 */
export function XrayScan({ active, children, color = "#6366f1", className = "" }) {
  return (
    <div className={`relative overflow-hidden rounded-xl ${className}`}>
      {children}
      {active && (
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `linear-gradient(${color}14 1px, transparent 1px), linear-gradient(90deg, ${color}14 1px, transparent 1px)`,
              backgroundSize: "18px 18px",
            }}
          />
          <div className="mo-scan-line absolute inset-x-0 top-0 h-full">
            <div
              className="h-16 w-full"
              style={{ background: `linear-gradient(180deg, transparent, ${color}33)` }}
            />
            <div
              className="h-0.5 w-full"
              style={{ background: color, boxShadow: `0 0 12px 2px ${color}` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
