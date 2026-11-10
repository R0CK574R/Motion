"""Model assumptions for the risk service.

Motion has no paid market-data feed yet, so risk is computed from a
one-factor model instead of price history: each asset is described by its
beta to the US equity market and the volatility of its own independent
noise. The numbers below are ILLUSTRATIVE, rounded, long-run estimates.
They are not live data and are not advice. Every API response says so.

To plug in real data later, replace `lookup()` with estimates computed from
price history (the C++ engine already has `beta` and `annualized_volatility`
for that) and leave the rest of the service alone.
"""

from dataclasses import dataclass

MODEL_VERSION = "one-factor-illustrative-v1"

# Annualised US equity market assumptions.
MARKET = {"vol": 0.16, "drift": 0.08, "risk_free": 0.04}


@dataclass(frozen=True)
class AssetAssumption:
    beta: float
    idio_vol: float  # annualised
    sector: str
    is_default: bool = False


# Used for any ticker not in the table: behaves like an average single stock.
DEFAULT = AssetAssumption(beta=1.0, idio_vol=0.30, sector="Unclassified", is_default=True)

_TABLE = {
    # Broad funds
    "SPY": (1.00, 0.02, "Broad Market"), "VOO": (1.00, 0.02, "Broad Market"),
    "IVV": (1.00, 0.02, "Broad Market"), "VTI": (1.02, 0.02, "Broad Market"),
    "QQQ": (1.15, 0.08, "Technology"), "VXUS": (0.85, 0.08, "International"),
    "BND": (0.05, 0.05, "Bond"), "AGG": (0.05, 0.05, "Bond"),
    "GLD": (0.10, 0.14, "Commodity"), "VNQ": (1.00, 0.14, "Real Estate"),
    # Technology and communication
    "AAPL": (1.20, 0.20, "Technology"), "MSFT": (1.10, 0.18, "Technology"),
    "NVDA": (1.80, 0.40, "Technology"), "AMD": (1.80, 0.40, "Technology"),
    "INTC": (1.10, 0.32, "Technology"), "GOOGL": (1.10, 0.22, "Communication Services"),
    "META": (1.30, 0.30, "Communication Services"), "NFLX": (1.30, 0.35, "Communication Services"),
    "DIS": (1.20, 0.24, "Communication Services"),
    # Consumer
    "AMZN": (1.25, 0.25, "Consumer Discretionary"), "TSLA": (2.00, 0.50, "Consumer Discretionary"),
    "HD": (1.00, 0.18, "Consumer Discretionary"), "COST": (0.80, 0.16, "Consumer Staples"),
    "WMT": (0.55, 0.15, "Consumer Staples"), "KO": (0.55, 0.13, "Consumer Staples"),
    "PG": (0.45, 0.13, "Consumer Staples"),
    # Financials
    "JPM": (1.10, 0.18, "Financials"), "BAC": (1.30, 0.22, "Financials"),
    "WFC": (1.15, 0.22, "Financials"), "C": (1.40, 0.24, "Financials"),
    "GS": (1.35, 0.22, "Financials"), "MS": (1.35, 0.22, "Financials"),
    "BRK.B": (0.85, 0.13, "Financials"), "V": (0.95, 0.16, "Financials"),
    "MA": (1.05, 0.17, "Financials"),
    # Healthcare and energy
    "JNJ": (0.50, 0.14, "Healthcare"), "UNH": (0.60, 0.20, "Healthcare"),
    "PFE": (0.60, 0.20, "Healthcare"), "XOM": (0.90, 0.24, "Energy"),
    "CVX": (0.95, 0.22, "Energy"),
}


def lookup(ticker: str) -> AssetAssumption:
    row = _TABLE.get(ticker.strip().upper())
    return AssetAssumption(*row) if row else DEFAULT


@dataclass(frozen=True)
class Scenario:
    key: str
    name: str
    description: str
    market_shock: float            # move in the broad US equity market
    sector_shocks: dict            # sectors that moved differently from beta * market


# Approximate peak-to-trough index moves, rounded. A position in a listed
# sector takes that sector's shock; every other position takes
# beta * market_shock.
SCENARIOS = [
    Scenario(
        "gfc_2008", "2008 financial crisis",
        "Oct 2007 to Mar 2009: US equities roughly -57%, financials far worse.",
        -0.57,
        {"Financials": -0.80, "Real Estate": -0.70, "Bond": 0.05, "Commodity": 0.20},
    ),
    Scenario(
        "covid_2020", "2020 COVID crash",
        "Feb to Mar 2020: US equities roughly -34% in five weeks.",
        -0.34,
        {"Energy": -0.55, "Real Estate": -0.40, "Bond": 0.0, "Commodity": -0.03},
    ),
    Scenario(
        "rates_2022", "2022 rate shock",
        "Jan to Oct 2022: equities roughly -25% while bonds fell with them.",
        -0.25,
        {"Technology": -0.35, "Communication Services": -0.40, "Bond": -0.17,
         "Energy": 0.45, "Real Estate": -0.30, "Commodity": -0.08},
    ),
    Scenario(
        "dotcom_2000", "Dot-com bust",
        "Mar 2000 to Oct 2002: US equities roughly -49%, technology roughly -78%.",
        -0.49,
        {"Technology": -0.78, "Communication Services": -0.70, "Bond": 0.20},
    ),
    Scenario(
        "rates_up_200bp", "Rates +2% (hypothetical)",
        "A sudden 2-point rise in interest rates. Hypothetical, not a historical event.",
        -0.10,
        {"Bond": -0.12, "Real Estate": -0.15, "Financials": -0.03},
    ),
]


def shock_for(assumption: AssetAssumption, scenario: Scenario) -> float:
    if assumption.sector in scenario.sector_shocks:
        return scenario.sector_shocks[assumption.sector]
    return max(assumption.beta * scenario.market_shock, -0.95)
