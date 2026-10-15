import React, { useState } from "react";
import { PieChart, Pie, Cell, Sector, ResponsiveContainer } from "recharts";
import { AnimatedNumber } from "./AnimatedNumber.jsx";

/**
 * Upgrade of the allocation donut:
 *  - hovering a slice (or its legend row) pops it outward with a halo ring
 *  - the other slices and legend rows dim, so the eye lands on one thing
 *  - the center readout swaps from the total to the hovered slice
 *
 * data:      [{ name, value }]
 * colorFor:  (name, index) => css color
 */
export function InteractiveDonut({ data, total, colorFor, format, pct, t }) {
  const [active, setActive] = useState(null);
  const focus = active == null ? null : data[active];

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="relative h-56 w-56 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius={64}
              outerRadius={92}
              paddingAngle={2}
              cornerRadius={4}
              stroke={t.chart.stroke}
              strokeWidth={2}
              activeIndex={active ?? undefined}
              activeShape={ActiveSlice}
              onMouseEnter={(_, i) => setActive(i)}
              onMouseLeave={() => setActive(null)}
              animationDuration={800}
            >
              {data.map((d, i) => (
                <Cell
                  key={d.name}
                  fill={colorFor(d.name, i)}
                  style={{
                    opacity: active == null || active === i ? 1 : 0.35,
                    transition: "opacity 200ms",
                    cursor: "pointer",
                  }}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>

        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className={`max-w-[7rem] truncate text-xs ${t.faint}`}>
            {focus ? focus.name : "total"}
          </span>
          <span className="font-mono text-lg font-semibold">
            <AnimatedNumber value={focus ? focus.value : total} format={format} />
          </span>
          {focus && (
            <span className={`font-mono text-xs ${t.muted}`}>{pct(focus.value / total)}</span>
          )}
        </div>
      </div>

      <div className="w-full space-y-1">
        {data.map((d, i) => (
          <button
            key={d.name}
            type="button"
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
            className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm transition"
            style={{
              opacity: active == null || active === i ? 1 : 0.45,
              background: active === i ? `${colorFor(d.name, i)}1a` : "transparent",
            }}
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: colorFor(d.name, i) }}
            />
            <span className={`flex-1 truncate ${t.body}`}>{d.name}</span>
            <span className={`font-mono tabular-nums ${t.muted}`}>{pct(d.value / total)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ActiveSlice(props) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, cornerRadius } = props;
  return (
    <g>
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={innerRadius - 2}
        outerRadius={outerRadius + 6}
        startAngle={startAngle}
        endAngle={endAngle}
        cornerRadius={cornerRadius}
        fill={fill}
      />
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={outerRadius + 9}
        outerRadius={outerRadius + 12}
        startAngle={startAngle}
        endAngle={endAngle}
        cornerRadius={2}
        fill={fill}
        opacity={0.5}
      />
    </g>
  );
}
