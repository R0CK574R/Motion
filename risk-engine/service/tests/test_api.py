import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

import motion_risk  # noqa: E402
from app import app  # noqa: E402

client = TestClient(app)

DEMO = {
    "cash": 6500,
    "positions": [
        {"ticker": "VOO", "value": 25 * 545},
        {"ticker": "MSFT", "value": 30 * 442},
        {"ticker": "AAPL", "value": 55 * 231},
        {"ticker": "COST", "value": 8 * 905},
        {"ticker": "AMZN", "value": 35 * 205},
        {"ticker": "NVDA", "value": 40 * 138},
        {"ticker": "JNJ", "value": 20 * 152},
    ],
}


def test_health():
    assert client.get("/health").json()["ok"] is True


def test_demo_portfolio():
    body = client.post("/risk", json=DEMO).json()
    total = DEMO["cash"] + sum(p["value"] for p in DEMO["positions"])
    assert math.isclose(body["total_value"], total)
    assert 0 < body["var"]["parametric"] < body["cvar"]["parametric"]
    # Both methods assume normal returns, so they should land close together.
    assert math.isclose(body["var"]["monte_carlo"], body["var"]["parametric"], rel_tol=0.05)
    assert math.isclose(sum(p["risk_contribution"] for p in body["positions"]), 1.0)
    assert math.isclose(sum(p["weight"] for p in body["positions"]) + DEMO["cash"] / total, 1.0)
    assert sum(body["simulated"]["histogram"]["counts"]) == 20000
    assert "not investment advice" in body["model"]["note"].lower()

    by_ticker = {p["ticker"]: p for p in body["positions"]}
    # Nvidia carries more of the risk than its share of the money; J&J less.
    assert by_ticker["NVDA"]["risk_contribution"] > by_ticker["NVDA"]["weight"]
    assert by_ticker["JNJ"]["risk_contribution"] < by_ticker["JNJ"]["weight"]


def test_scenarios_add_up():
    body = client.post("/risk", json=DEMO).json()
    assert [s["key"] for s in body["scenarios"]][0] == "gfc_2008"
    for scenario in body["scenarios"]:
        assert math.isclose(scenario["pnl"], sum(p["pnl"] for p in scenario["positions"]))
        assert scenario["pnl"] < 0
    dotcom = next(s for s in body["scenarios"] if s["key"] == "dotcom_2000")
    msft = next(p for p in dotcom["positions"] if p["ticker"] == "MSFT")
    assert msft["shock"] == -0.78  # sector shock, not beta * market


def test_same_seed_same_answer():
    first = client.post("/risk", json=DEMO).json()
    second = client.post("/risk", json=DEMO).json()
    assert first == second
    other = client.post("/risk", json={**DEMO, "seed": 7}).json()
    assert other["var"]["monte_carlo"] != first["var"]["monte_carlo"]
    assert other["var"]["parametric"] == first["var"]["parametric"]


def test_duplicate_tickers_are_merged_and_unknown_flagged():
    body = client.post("/risk", json={"positions": [
        {"ticker": "aapl", "value": 100}, {"ticker": "AAPL ", "value": 50},
        {"ticker": "ZZZZ", "value": 10}]}).json()
    by_ticker = {p["ticker"]: p for p in body["positions"]}
    assert by_ticker["AAPL"]["value"] == 150
    assert by_ticker["ZZZZ"]["uses_default_assumption"] is True
    assert by_ticker["AAPL"]["uses_default_assumption"] is False


def test_empty_and_cash_only():
    for payload in ({"positions": []}, {"positions": [], "cash": 1000}):
        body = client.post("/risk", json=payload).json()
        assert body["var"]["parametric"] == 0 and body["positions"] == []


def test_rejects_bad_input():
    assert client.post("/risk", json={"positions": [{"ticker": "A", "value": -1}]}).status_code == 422
    assert client.post("/risk", json={**DEMO, "confidence": 1.0}).status_code == 422
    assert client.post("/risk", json={**DEMO, "simulations": 5}).status_code == 422
    assert client.post("/risk", json={**DEMO, "horizon_days": 0}).status_code == 422


def test_bindings_expose_series_measures():
    assert math.isclose(motion_risk.max_drawdown([100, 120, 90, 110, 80]), 1 / 3)
    assert math.isclose(motion_risk.inverse_normal_cdf(0.95), 1.6448536, rel_tol=1e-6)
    try:
        motion_risk.max_drawdown([1, 0])
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError")


def test_token_is_required_once_configured(monkeypatch):
    monkeypatch.setenv("RISK_ENGINE_TOKEN", "s3cret-token")
    assert client.post("/risk", json=DEMO).status_code == 401
    wrong = {"Authorization": "Bearer not-it"}
    assert client.post("/risk", json=DEMO, headers=wrong).status_code == 401
    right = {"Authorization": "Bearer s3cret-token"}
    assert client.post("/risk", json=DEMO, headers=right).status_code == 200
    # The health check stays open for the hosting platform.
    assert client.get("/health").status_code == 200


def test_no_token_configured_means_open(monkeypatch):
    monkeypatch.delenv("RISK_ENGINE_TOKEN", raising=False)
    assert client.post("/risk", json=DEMO).status_code == 200
