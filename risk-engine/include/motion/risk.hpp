// Motion risk engine: portfolio risk measures in dependency-free C++17.
//
// Conventions used everywhere in this file:
//   * Volatility, drift and the risk-free rate are ANNUALISED decimals
//     (0.16 means 16% a year). The engine scales them to the horizon itself.
//   * A year is 252 trading days.
//   * Value at risk (VaR) and expected shortfall (CVaR) are reported as
//     POSITIVE currency losses: var = 1200 means "lose 1,200 or more".
#pragma once

#include <cstdint>
#include <vector>

namespace motion::risk {

inline constexpr double kTradingDays = 252.0;

// ---------------------------------------------------------------- inputs

// One position, described by a single-factor (market) model:
//   asset return = beta * market return + its own independent noise.
struct Asset {
  double value = 0.0;     // current market value in currency
  double beta = 1.0;      // sensitivity to the market factor
  double idio_vol = 0.0;  // annualised volatility of the asset's own noise
};

struct Market {
  double vol = 0.16;        // annualised market volatility
  double drift = 0.08;      // annualised expected market return
  double risk_free = 0.04;  // annualised risk-free rate
};

struct Config {
  double confidence = 0.95;       // 0.95 means the worst 5% of outcomes
  int horizon_days = 1;           // holding period in trading days
  int simulations = 20000;        // Monte Carlo paths
  std::uint64_t seed = 42;        // same seed, same result, on any machine
  int histogram_bins = 41;
};

// --------------------------------------------------------------- outputs

struct Histogram {
  double min = 0.0;             // left edge of the first bin (P&L)
  double max = 0.0;             // right edge of the last bin (P&L)
  std::vector<int> counts;      // simulations per bin
};

struct Result {
  double total_value = 0.0;      // positions + cash
  double invested_value = 0.0;   // positions only
  double volatility = 0.0;       // annualised, on total value
  double beta = 0.0;             // on total value (cash has beta 0)
  double expected_return = 0.0;  // annualised, CAPM, on total value
  double sharpe = 0.0;           // (expected_return - risk_free) / volatility

  double parametric_var = 0.0;   // closed form, normal returns
  double parametric_cvar = 0.0;
  double mc_var = 0.0;           // Monte Carlo
  double mc_cvar = 0.0;
  double mc_worst = 0.0;         // worst simulated P&L (negative)
  double mc_best = 0.0;          // best simulated P&L

  // Share of portfolio variance each asset is responsible for. Sums to 1.
  std::vector<double> risk_contribution;
  Histogram histogram;           // distribution of simulated P&L
};

// ------------------------------------------------------- portfolio model

// Annualised covariance matrix implied by the one-factor model, row-major
// n x n:  cov[i][j] = beta_i * beta_j * market_vol^2  (+ idio_vol_i^2 if i==j)
std::vector<double> covariance(const std::vector<Asset>& assets, const Market& market);

// Lower-triangular Cholesky factor L of a symmetric positive semi-definite
// matrix A (row-major n x n), so that L * L^T = A. Throws std::invalid_argument
// if A is not positive semi-definite.
std::vector<double> cholesky(const std::vector<double>& a, int n);

// Full analysis: closed-form and Monte Carlo risk for the portfolio.
// Throws std::invalid_argument on bad input (negative values, confidence
// outside (0.5, 1), non-positive horizon, too few simulations).
Result analyze(const std::vector<Asset>& assets, double cash,
               const Market& market, const Config& config);

// Profit or loss per position when each one moves by its shock
// (shock -0.30 means the position loses 30%).
std::vector<double> stress(const std::vector<double>& values,
                           const std::vector<double>& shocks);

// ------------------------------------------------- return-series measures
// These work on observed history, for when real price data is plugged in.

// Historical VaR/CVaR as a positive fraction of value (0.02 means 2%).
double historical_var(std::vector<double> returns, double confidence);
double historical_cvar(std::vector<double> returns, double confidence);

// Largest peak-to-trough fall as a positive fraction (0.25 means -25%).
double max_drawdown(const std::vector<double>& prices);

double annualized_volatility(const std::vector<double>& daily_returns);
double sharpe_ratio(const std::vector<double>& daily_returns, double annual_risk_free);

// Slope of the asset's returns against the market's: cov(a, m) / var(m).
double beta(const std::vector<double>& asset_returns,
            const std::vector<double>& market_returns);

// ---------------------------------------------------------------- maths

// Inverse of the standard normal CDF (Acklam's rational approximation,
// absolute error below 1.2e-9). inverse_normal_cdf(0.95) is about 1.6449.
double inverse_normal_cdf(double p);

}  // namespace motion::risk
