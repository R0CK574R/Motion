# Motion risk engine

Portfolio risk measures in dependency-free C++17, exposed to Python with
pybind11 and served over HTTP by a small FastAPI app. The Motion API calls it;
browsers never do.

```
browser -> Motion API (/api/risk) -> risk service (FastAPI) -> C++ engine
```

## What it computes

| Measure | Meaning |
| --- | --- |
| Value at risk (VaR) | The loss the portfolio should stay within on, say, 95% of days. |
| Expected shortfall (CVaR) | The average loss on the days that are worse than VaR. |
| Volatility, beta, Sharpe | Annualised swing, sensitivity to the market, return per unit of risk. |
| Risk contribution | Each position's share of total portfolio variance. Sums to 100%. |
| Stress tests | Loss if a historical episode (2008, 2020, 2022, dot-com) repeated. |

VaR and CVaR are computed twice: in closed form, and by Monte Carlo with
correlated shocks drawn through a Cholesky factor of the covariance matrix.
Both assume normal returns, so they must agree up to sampling noise. A unit
test enforces that, which is how the simulation is validated.

For observed price history there are also `historical_var`,
`historical_cvar`, `max_drawdown`, `annualized_volatility`, `sharpe_ratio`
and `beta`.

## The model, and its limits

There is no paid market-data feed yet, so risk comes from a **one-factor
model**: each asset is its beta to the US equity market plus independent
noise. The per-ticker numbers in `service/assumptions.py` are rounded,
illustrative, long-run estimates, and unknown tickers are treated as an
average single stock (and flagged in the response). Known limits:

- Returns are assumed normal. Real markets have fatter tails, so real
  extreme losses are larger than this model says.
- One factor cannot capture sector or style effects between stocks.
- Stress scenarios use approximate index moves, not each stock's own history.

Every response carries a note saying the figures are illustrative.

## Layout

```
include/motion/risk.hpp   public API, documented
src/risk.cpp              implementation
tests/test_risk.cpp       C++ unit tests (run by CTest)
bindings/python.cpp       pybind11 module `motion_risk`
service/app.py            FastAPI wrapper: POST /risk, GET /health
service/assumptions.py    model assumptions and stress scenarios
service/tests/            API tests (pytest)
```

## Build and test

```bash
pip install -r requirements-dev.txt
cmake -S . -B build -Dpybind11_DIR="$(python -m pybind11 --cmakedir)"
cmake --build build -j
ctest --test-dir build --output-on-failure   # C++ tests
python -m pytest service/tests               # API tests
```

## Run

```bash
cd service && uvicorn app:app --port 8000
curl -s localhost:8000/risk -H 'content-type: application/json' \
  -d '{"cash": 1000, "positions": [{"ticker": "AAPL", "value": 5000}]}'
```

Or `docker compose up --build` from the repo root, which builds the engine,
runs its tests during the image build, and wires it to the API.

Results are reproducible: the random generator is a seeded 64-bit Mersenne
Twister with a hand-written Box-Muller transform, so the same request gives
the same numbers on any machine.
