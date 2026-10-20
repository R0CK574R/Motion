/**
 * Seed data for demo accounts.
 *
 * The canned analysis below is deliberately consistent with these exact
 * holdings — every demo user gets this same portfolio, so the numbers quoted
 * in the observations always match what's on screen. If you change the
 * holdings, update the analysis text too.
 *
 * Serving a cached analysis (rather than calling Anthropic per visitor) means
 * demo traffic costs nothing, returns instantly, and can't be used to burn
 * your API credits.
 */

const DEMO_CASH = 6500;

const DEMO_HOLDINGS = [
  { ticker: "VOO", shares: 25, cost: 398, price: 545 },
  { ticker: "MSFT", shares: 30, cost: 305, price: 442 },
  { ticker: "AAPL", shares: 55, cost: 152, price: 231 },
  { ticker: "COST", shares: 8, cost: 520, price: 905 },
  { ticker: "AMZN", shares: 35, cost: 130, price: 205 },
  { ticker: "NVDA", shares: 40, cost: 48, price: 138 },
  { ticker: "JNJ", shares: 20, cost: 158, price: 152 },
];

const DEMO_ANALYSIS = {
  classifications: [
    { ticker: "VOO", assetClass: "US Equity", sector: "Broad Market" },
    { ticker: "MSFT", assetClass: "US Equity", sector: "Technology" },
    { ticker: "AAPL", assetClass: "US Equity", sector: "Technology" },
    { ticker: "COST", assetClass: "US Equity", sector: "Consumer Staples" },
    { ticker: "AMZN", assetClass: "US Equity", sector: "Consumer Discretionary" },
    { ticker: "NVDA", assetClass: "US Equity", sector: "Technology" },
    { ticker: "JNJ", assetClass: "US Equity", sector: "Healthcare" },
  ],
  observations: [
    "The portfolio is entirely US equity, with no international, bond, or real-asset exposure of any kind.",
    "Technology is the dominant sector: Microsoft, Apple, and Nvidia together account for roughly 45% of total value, before counting the technology weighting already inside the VOO index fund.",
    "A single broad-market index fund, VOO, is the largest position at about 20%, which spreads part of the portfolio across roughly 500 companies.",
    "Cash sits at roughly 9% of the total. Unrealized gains are led by Nvidia, up close to 190% from its cost basis, followed by Costco at about 74%.",
  ],
  risks: [
    "The three largest positions make up about 57% of the portfolio, so overall returns track a small number of holdings closely.",
    "Because VOO is itself heavily weighted toward large-cap technology, the effective technology exposure is higher than the individual stock weightings alone suggest.",
    "Every holding is denominated in US dollars and listed in the US market, so there is no geographic diversification to offset a domestic downturn.",
  ],
};

module.exports = { DEMO_CASH, DEMO_HOLDINGS, DEMO_ANALYSIS };
