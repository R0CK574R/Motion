# Graphics upgrades

Drop-in visual components for the dashboard. They take the existing theme
tokens (`t`) and `computePortfolio()` output, so they need no new dependencies
or backend changes.

**Preview:** `npm run dev`, then open http://localhost:5173/preview.html (mock data, no backend).

| Component | Replaces / adds | Data it needs |
|---|---|---|
| `StatTilePro` | `StatTile` — count-up value, delta chip, accent bar, optional sparkline | number + formatter (`spark` needs price history, which Motion doesn't have yet) |
| `InteractiveDonut` | Allocation donut — hover pop-out, legend sync, live center readout | the existing `donut` array |
| `HoldingsTreemap` | new — heatmap: area = value, color = return on cost | `model.positions` |
| `ConcentrationGauge` | new — HHI gauge + "effective positions" | `model.positions` |
| `PnLContribution` | new — diverging $ gain/loss bars | `model.positions` |
| `DashboardSkeleton` | loading spinner in `Dashboard.jsx` | — |
| `XrayScan` | "Running the X-ray…" spinner — scan-line sweep over cards | `running` flag |

## Wiring into `Dashboard.jsx`

```jsx
import { StatTilePro, InteractiveDonut, HoldingsTreemap, ConcentrationGauge,
         PnLContribution, DashboardSkeleton, XrayScan } from "./upgrades/index.js";

// loading state
if (loading) return <div className={`min-h-screen ${t.page}`}><div className="mx-auto max-w-5xl px-5 py-12">
  <DashboardSkeleton t={t} dark={resolved === "dark"} /></div></div>;

// stat tile
<StatTilePro t={t} label="Total value" value={model.total} format={usd0.format} tone={t.heading} />

// allocation donut (inside the existing <section>)
<XrayScan active={running}>
  <InteractiveDonut data={donut} total={model.total}
    colorFor={(n, i) => colorFor(n, i, t.chart)} format={usd0.format} pct={pct} t={t} />
</XrayScan>

// new cards
<HoldingsTreemap positions={model.positions} dark={resolved === "dark"}
  format={usd0.format} signedPct={signedPct} t={t} />
<ConcentrationGauge positions={model.positions} t={t} />
<PnLContribution positions={model.positions} signedUsd={signedUsd} t={t} />
```

All animations respect `prefers-reduced-motion`.
