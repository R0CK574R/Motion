package com.motion.analysis;

/**
 * The analysis every demo account is served. It is consistent with the
 * holdings in {@code ledger.DemoPortfolio}; change one and you must change
 * the other. Serving a fixed result means demo traffic costs nothing, returns
 * instantly, and cannot be used to run up the AI bill.
 */
final class DemoAnalysis {

  static final String JSON =
      """
      {
        "classifications": [
          {"ticker": "VOO", "assetClass": "US Equity", "sector": "Broad Market"},
          {"ticker": "MSFT", "assetClass": "US Equity", "sector": "Technology"},
          {"ticker": "AAPL", "assetClass": "US Equity", "sector": "Technology"},
          {"ticker": "COST", "assetClass": "US Equity", "sector": "Consumer Staples"},
          {"ticker": "AMZN", "assetClass": "US Equity", "sector": "Consumer Discretionary"},
          {"ticker": "NVDA", "assetClass": "US Equity", "sector": "Technology"},
          {"ticker": "JNJ", "assetClass": "US Equity", "sector": "Healthcare"}
        ],
        "observations": [
          "The portfolio is entirely US equity, with no international, bond, or real-asset exposure of any kind.",
          "Technology is the dominant sector: Microsoft, Apple, and Nvidia together account for roughly 45% of total value, before counting the technology weighting already inside the VOO index fund.",
          "A single broad-market index fund, VOO, is the largest position at about 20%, which spreads part of the portfolio across roughly 500 companies.",
          "Cash sits at roughly 9% of the total. Unrealized gains are led by Nvidia, up close to 190% from its cost basis, followed by Costco at about 74%."
        ],
        "risks": [
          "The three largest positions make up about 57% of the portfolio, so overall returns track a small number of holdings closely.",
          "Because VOO is itself heavily weighted toward large-cap technology, the effective technology exposure is higher than the individual stock weightings alone suggest.",
          "Every holding is denominated in US dollars and listed in the US market, so there is no geographic diversification to offset a domestic downturn."
        ]
      }
      """;

  private DemoAnalysis() {}
}
