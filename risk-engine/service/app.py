"""HTTP wrapper around the C++ risk engine.

This service is internal: the Motion API calls it, browsers never do. It
holds no user data and no secrets. It receives position values, runs the
numbers in C++ (the `motion_risk` module), and returns JSON.
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

import motion_risk
from assumptions import MARKET, MODEL_VERSION, SCENARIOS, lookup, shock_for

app = FastAPI(title="Motion risk engine", version="1.0.0")


class Position(BaseModel):
    ticker: str = Field(min_length=1, max_length=12)
    value: float = Field(ge=0, le=1e12)


class RiskRequest(BaseModel):
    positions: list[Position] = Field(max_length=200)
    cash: float = Field(default=0, ge=0, le=1e12)
    confidence: float = Field(default=0.95, gt=0.5, lt=1)
    horizon_days: int = Field(default=1, ge=1, le=252)
    simulations: int = Field(default=20000, ge=1000, le=200000)
    seed: int = Field(default=42, ge=0, le=2**32)


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_VERSION}


@app.post("/risk")
def risk(req: RiskRequest):
    # The same ticker entered twice is one exposure, so merge before modelling.
    merged: dict[str, float] = {}
    for position in req.positions:
        ticker = position.ticker.strip().upper()
        merged[ticker] = merged.get(ticker, 0.0) + position.value
    tickers = [t for t, v in merged.items() if v > 0]
    values = [merged[t] for t in tickers]
    assumptions = [lookup(t) for t in tickers]

    assets = [motion_risk.Asset(v, a.beta, a.idio_vol) for v, a in zip(values, assumptions)]
    market = motion_risk.Market(MARKET["vol"], MARKET["drift"], MARKET["risk_free"])
    config = motion_risk.Config(req.confidence, req.horizon_days, req.simulations, req.seed)
    try:
        result = motion_risk.analyze(assets, req.cash, market, config)
    except ValueError as err:  # raised by the engine's input checks
        raise HTTPException(status_code=422, detail=str(err)) from err

    total = result.total_value

    def share(amount: float) -> float:
        return amount / total if total > 0 else 0.0

    scenarios = []
    for scenario in SCENARIOS:
        shocks = [shock_for(a, scenario) for a in assumptions]
        pnl = motion_risk.stress(values, shocks)
        loss = sum(pnl)
        scenarios.append({
            "key": scenario.key,
            "name": scenario.name,
            "description": scenario.description,
            "pnl": loss,
            "pnl_pct": share(loss),
            "positions": [
                {"ticker": t, "shock": s, "pnl": p} for t, s, p in zip(tickers, shocks, pnl)
            ],
        })

    return {
        "model": {
            "version": MODEL_VERSION,
            "market": MARKET,
            "note": "Illustrative one-factor model with rounded long-run assumptions. "
                    "Not live market data and not investment advice.",
        },
        "config": {
            "confidence": req.confidence,
            "horizon_days": req.horizon_days,
            "simulations": req.simulations,
            "seed": req.seed,
        },
        "total_value": total,
        "invested_value": result.invested_value,
        "volatility": result.volatility,
        "beta": result.beta,
        "expected_return": result.expected_return,
        "sharpe": result.sharpe,
        "var": {
            "parametric": result.parametric_var,
            "parametric_pct": share(result.parametric_var),
            "monte_carlo": result.mc_var,
            "monte_carlo_pct": share(result.mc_var),
        },
        "cvar": {
            "parametric": result.parametric_cvar,
            "parametric_pct": share(result.parametric_cvar),
            "monte_carlo": result.mc_cvar,
            "monte_carlo_pct": share(result.mc_cvar),
        },
        "simulated": {
            "worst": result.mc_worst,
            "best": result.mc_best,
            "histogram": {
                "min": result.histogram.min,
                "max": result.histogram.max,
                "counts": result.histogram.counts,
            },
        },
        "positions": [
            {
                "ticker": t,
                "value": v,
                "weight": share(v),
                "risk_contribution": rc,
                "beta": a.beta,
                "idio_vol": a.idio_vol,
                "sector": a.sector,
                "uses_default_assumption": a.is_default,
            }
            for t, v, a, rc in zip(tickers, values, assumptions, result.risk_contribution)
        ],
        "scenarios": scenarios,
    }
