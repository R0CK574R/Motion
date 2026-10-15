import React, { useMemo } from "react";
import { Treemap, ResponsiveContainer, Tooltip } from "recharts";

/**
 * Finviz-style heatmap: tile area = position value, tile color = return on
 * cost. Reads concentration and performance in one glance, which the donut
 * and bar list each only do half of.
 *
 * positions: computePortfolio(...).positions
 */
const CAP = 0.4; // ±40% return saturates the color scale

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, k) => {
  const [A, B] = [hex(a), hex(b)];
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * k)).join(",")})`;
};

export function returnColor(gainPct, dark) {
  const neutral = dark ? "#262626" : "#e5e7eb";
  const k = Math.min(1, Math.abs(gainPct) / CAP);
  const target = gainPct >= 0 ? (dark ? "#059669" : "#10b981") : dark ? "#e11d48" : "#f43f5e";
  // sqrt so small moves are still visibly tinted
  return mix(neutral, target, Math.sqrt(k));
}

export function HoldingsTreemap({ positions, dark, format, signedPct, t, height = 280 }) {
  const data = useMemo(
    () =>
      positions.map((p) => ({
        name: p.ticker,
        size: p.value,
        gainPct: p.gainPct,
        weight: p.weight,
      })),
    [positions]
  );

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <Treemap
          data={data}
          dataKey="size"
          aspectRatio={4 / 3}
          isAnimationActive
          animationDuration={600}
          content={<Tile dark={dark} signedPct={signedPct} />}
        >
          <Tooltip
            content={({ payload }) => {
              const d = payload?.[0]?.payload;
              if (!d) return null;
              return (
                <div
                  className="rounded-lg border px-3 py-2 font-mono text-xs shadow-lg"
                  style={{
                    background: t.chart.tooltipBg,
                    borderColor: t.chart.tooltipBorder,
                    color: t.chart.tooltipText,
                  }}
                >
                  <div className="font-semibold">{d.name}</div>
                  <div>{format(d.size)}</div>
                  <div style={{ color: d.gainPct >= 0 ? "#10b981" : "#f43f5e" }}>
                    {signedPct(d.gainPct)}
                  </div>
                </div>
              );
            }}
          />
        </Treemap>
      </ResponsiveContainer>
    </div>
  );
}

function Tile(props) {
  const { x, y, width, height, name, gainPct, depth, dark, signedPct } = props;
  if (depth !== 1 || width <= 0 || height <= 0) return null;
  const fill = returnColor(gainPct ?? 0, dark);
  const strong = Math.abs(gainPct ?? 0) > CAP * 0.35;
  const text = strong || dark ? "#ffffff" : "#171717";
  const showLabel = width > 44 && height > 28;
  const showPct = width > 52 && height > 46;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={6}
        fill={fill}
        stroke={dark ? "#0a0a0a" : "#ffffff"}
        strokeWidth={3}
        style={{ transition: "fill 400ms" }}
      />
      {showLabel && (
        <text
          x={x + width / 2}
          y={y + height / 2 - (showPct ? 6 : -4)}
          textAnchor="middle"
          fill={text}
          fontFamily="ui-monospace, monospace"
          fontWeight={600}
          fontSize={Math.min(18, Math.max(11, width / 7))}
        >
          {name}
        </text>
      )}
      {showPct && (
        <text
          x={x + width / 2}
          y={y + height / 2 + 14}
          textAnchor="middle"
          fill={text}
          fillOpacity={0.85}
          fontFamily="ui-monospace, monospace"
          fontSize={11}
        >
          {signedPct(gainPct ?? 0)}
        </text>
      )}
    </g>
  );
}
