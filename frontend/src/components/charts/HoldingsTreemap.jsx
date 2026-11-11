import React, { useMemo } from "react";
import { Treemap, ResponsiveContainer, Tooltip } from "recharts";

/**
 * Heatmap of the portfolio: a tile's area is the position's value and its
 * colour is the return on cost. Size shows concentration and colour shows
 * performance, in one picture.
 *
 * positions: computePortfolio(...).positions
 */
const CAP = 0.6; // a 60% move, up or down, gets the strongest tint

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, k) => {
  const [A, B] = [hex(a), hex(b)];
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * k)).join(",")})`;
};

/** 0 for no move, 1 for a move of CAP or more. */
const strength = (gainPct) => Math.min(1, Math.abs(gainPct) / CAP);

/**
 * A tint, never a saturated block: the tiles sit beside tables of figures
 * and must not shout over them. Colour says direction, depth says size.
 */
export function returnColor(gainPct, dark) {
  const neutral = dark ? "#262626" : "#eceef0";
  const target = gainPct >= 0 ? (dark ? "#3f9c7d" : "#2f7d62") : dark ? "#c9575f" : "#a3262d";
  return mix(neutral, target, 0.14 + 0.5 * strength(gainPct));
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
          isAnimationActive={false}
          content={<Tile dark={dark} signedPct={signedPct} />}
        >
          <Tooltip
            content={({ payload }) => {
              const d = payload?.[0]?.payload;
              if (!d) return null;
              return (
                <div
                  className="rounded-md border px-3 py-2 text-xs tabular-nums shadow-lg"
                  style={{
                    background: t.chart.tooltipBg,
                    borderColor: t.chart.tooltipBorder,
                    color: t.chart.tooltipText,
                  }}
                >
                  <div className="font-semibold">{d.name}</div>
                  <div>{format(d.size)}</div>
                  <div>
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
  // The tints stay light in the light theme and dark in the dark one, so one
  // text colour per theme keeps every label readable.
  const text = dark ? "#ffffff" : "#16202c";
  const showLabel = width > 44 && height > 28;
  const showPct = width > 52 && height > 46;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={3}
        fill={fill}
        stroke={dark ? "#171717" : "#ffffff"}
        strokeWidth={2}
      />
      {showLabel && (
        <text
          x={x + width / 2}
          y={y + height / 2 - (showPct ? 6 : -4)}
          textAnchor="middle"
          fill={text}
          fontFamily="IBM Plex Sans, sans-serif"
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
          fontFamily="IBM Plex Sans, sans-serif"
          fontSize={11}
        >
          {signedPct(gainPct ?? 0)}
        </text>
      )}
    </g>
  );
}
