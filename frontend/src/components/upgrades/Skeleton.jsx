import React from "react";
import "./upgrades.css";

/**
 * Shimmering placeholders shaped like the dashboard, to replace the lone
 * spinner while /api/portfolio loads. Layout doesn't jump when data arrives.
 */
export function Bone({ className = "", dark }) {
  return (
    <div
      className={`mo-shimmer rounded-md ${dark ? "bg-neutral-800" : "bg-neutral-200"} ${className}`}
      style={{ "--mo-shimmer": dark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.7)" }}
    />
  );
}

export function DashboardSkeleton({ t, dark }) {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading portfolio">
      <div className={`rounded-xl border p-5 ${t.card}`}>
        <Bone dark={dark} className="mb-4 h-4 w-32" />
        {[0, 1, 2].map((i) => (
          <Bone key={i} dark={dark} className="mb-2 h-9 w-full" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`rounded-xl border p-4 ${t.card}`}>
            <Bone dark={dark} className="mb-2 h-3 w-16" />
            <Bone dark={dark} className="h-6 w-24" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className={`flex items-center gap-6 rounded-xl border p-5 ${t.card}`}>
          <Bone dark={dark} className="h-44 w-44 shrink-0 !rounded-full" />
          <div className="w-full space-y-2">
            {[0, 1, 2, 3].map((i) => <Bone key={i} dark={dark} className="h-3 w-full" />)}
          </div>
        </div>
        <div className={`space-y-3 rounded-xl border p-5 ${t.card}`}>
          {[0, 1, 2, 3, 4].map((i) => <Bone key={i} dark={dark} className="h-4 w-full" />)}
        </div>
      </div>
    </div>
  );
}
