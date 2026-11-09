// Unit tests for the risk engine. No framework: each CHECK records a failure
// and the process exits non-zero if any failed, which is all CTest needs.
#include "motion/risk.hpp"

#include <cmath>
#include <cstdio>
#include <numeric>
#include <stdexcept>
#include <vector>

using namespace motion::risk;

static int failures = 0;

#define CHECK(condition)                                                      \
  do {                                                                        \
    if (!(condition)) {                                                       \
      std::printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #condition);        \
      ++failures;                                                             \
    }                                                                         \
  } while (0)

#define CHECK_NEAR(actual, expected, tolerance)                               \
  do {                                                                        \
    const double a_ = (actual), e_ = (expected);                              \
    if (!(std::abs(a_ - e_) <= (tolerance))) {                                \
      std::printf("FAIL %s:%d  %s = %.10g, expected %.10g\n", __FILE__,       \
                  __LINE__, #actual, a_, e_);                                 \
      ++failures;                                                             \
    }                                                                         \
  } while (0)

#define CHECK_THROWS(expression)                                              \
  do {                                                                        \
    bool threw_ = false;                                                      \
    try { (void)(expression); } catch (const std::invalid_argument&) { threw_ = true; } \
    if (!threw_) {                                                            \
      std::printf("FAIL %s:%d  %s did not throw\n", __FILE__, __LINE__, #expression); \
      ++failures;                                                             \
    }                                                                         \
  } while (0)

static void test_inverse_normal() {
  CHECK_NEAR(inverse_normal_cdf(0.5), 0.0, 1e-9);
  CHECK_NEAR(inverse_normal_cdf(0.95), 1.6448536270, 1e-8);
  CHECK_NEAR(inverse_normal_cdf(0.99), 2.3263478740, 1e-8);
  CHECK_NEAR(inverse_normal_cdf(0.001), -3.0902323062, 1e-8);
  CHECK_THROWS(inverse_normal_cdf(0.0));
  CHECK_THROWS(inverse_normal_cdf(1.0));
}

static void test_cholesky() {
  // Textbook example: A = L * L^T with L = [[2,0,0],[6,1,0],[-8,5,3]].
  const std::vector<double> a = {4, 12, -16, 12, 37, -43, -16, -43, 98};
  const std::vector<double> l = cholesky(a, 3);
  const std::vector<double> expected = {2, 0, 0, 6, 1, 0, -8, 5, 3};
  for (int i = 0; i < 9; ++i) CHECK_NEAR(l[i], expected[i], 1e-12);

  // Two perfectly correlated assets give a semi-definite matrix; still valid.
  const std::vector<double> flat = cholesky({1, 1, 1, 1}, 2);
  CHECK_NEAR(flat[2], 1.0, 1e-12);
  CHECK_NEAR(flat[3], 0.0, 1e-12);

  CHECK_THROWS(cholesky({1, 2, 2, 1}, 2));  // eigenvalue -1
  CHECK_THROWS(cholesky({1, 2, 3}, 2));     // wrong size
}

static void test_covariance() {
  const Market market{0.20, 0.08, 0.04};
  const std::vector<Asset> assets = {{100, 1.5, 0.30}, {100, 0.5, 0.10}};
  const std::vector<double> cov = covariance(assets, market);
  CHECK_NEAR(cov[0], 1.5 * 1.5 * 0.04 + 0.09, 1e-12);
  CHECK_NEAR(cov[1], 1.5 * 0.5 * 0.04, 1e-12);
  CHECK_NEAR(cov[2], cov[1], 1e-12);
  CHECK_NEAR(cov[3], 0.5 * 0.5 * 0.04 + 0.01, 1e-12);
}

static void test_single_asset_closed_form() {
  // One asset tracking the market exactly, no drift: 1-day 95% VaR is
  // value * z * vol / sqrt(252).
  const Market market{0.16, 0.0, 0.0};
  const Result r = analyze({{100000, 1.0, 0.0}}, 0.0, market, Config{});
  const double sigma = 100000 * 0.16 / std::sqrt(252.0);
  CHECK_NEAR(r.parametric_var, 1.6448536270 * sigma, 1e-4);
  CHECK_NEAR(r.parametric_cvar, sigma * 0.1031356404 / 0.05, 1e-3);
  CHECK_NEAR(r.volatility, 0.16, 1e-12);
  CHECK_NEAR(r.beta, 1.0, 1e-12);
  CHECK_NEAR(r.risk_contribution[0], 1.0, 1e-12);
  CHECK(r.parametric_cvar > r.parametric_var);
}

static void test_monte_carlo_matches_closed_form() {
  const Market market{0.16, 0.08, 0.04};
  const std::vector<Asset> assets = {
      {50000, 1.0, 0.02}, {30000, 1.8, 0.40}, {20000, 0.5, 0.14}};
  Config config;
  config.simulations = 200000;
  const Result r = analyze(assets, 10000.0, market, config);
  // Returns are normal in both methods, so they must agree up to sampling noise.
  CHECK_NEAR(r.mc_var / r.parametric_var, 1.0, 0.02);
  CHECK_NEAR(r.mc_cvar / r.parametric_cvar, 1.0, 0.02);
  CHECK(r.mc_worst < 0.0 && r.mc_best > 0.0);

  const int total = std::accumulate(r.histogram.counts.begin(), r.histogram.counts.end(), 0);
  CHECK(total == config.simulations);
  CHECK_NEAR(r.histogram.min, r.mc_worst, 1e-9);
  CHECK_NEAR(r.histogram.max, r.mc_best, 1e-9);
}

static void test_risk_contributions() {
  const Market market{0.16, 0.08, 0.04};
  const std::vector<Asset> assets = {
      {50000, 1.0, 0.02}, {30000, 1.8, 0.40}, {20000, 0.5, 0.14}};
  const Result r = analyze(assets, 0.0, market, Config{});
  const double sum = std::accumulate(r.risk_contribution.begin(), r.risk_contribution.end(), 0.0);
  CHECK_NEAR(sum, 1.0, 1e-12);
  // The volatile, high-beta asset holds 30% of the money but most of the risk.
  CHECK(r.risk_contribution[1] > 0.5);
  CHECK(r.risk_contribution[2] < 0.2);
}

static void test_cash_and_horizon() {
  const Market market{0.16, 0.0, 0.0};
  const Result invested = analyze({{100000, 1.0, 0.0}}, 0.0, market, Config{});
  const Result half_cash = analyze({{100000, 1.0, 0.0}}, 100000.0, market, Config{});
  // Cash adds value but no risk: same currency VaR, half the volatility and beta.
  CHECK_NEAR(half_cash.parametric_var, invested.parametric_var, 1e-9);
  CHECK_NEAR(half_cash.volatility, 0.08, 1e-12);
  CHECK_NEAR(half_cash.beta, 0.5, 1e-12);

  Config ten_days;
  ten_days.horizon_days = 10;
  const Result longer = analyze({{100000, 1.0, 0.0}}, 0.0, market, ten_days);
  CHECK_NEAR(longer.parametric_var / invested.parametric_var, std::sqrt(10.0), 1e-9);
}

static void test_determinism_and_edge_cases() {
  const Market market{};
  const std::vector<Asset> assets = {{1000, 1.2, 0.2}, {2000, 0.8, 0.1}};
  Config config;
  const Result a = analyze(assets, 0.0, market, config);
  const Result b = analyze(assets, 0.0, market, config);
  CHECK(a.mc_var == b.mc_var && a.histogram.counts == b.histogram.counts);
  config.seed = 7;
  CHECK(analyze(assets, 0.0, market, config).mc_var != a.mc_var);

  const Result empty = analyze({}, 500.0, market, Config{});
  CHECK(empty.total_value == 500.0 && empty.parametric_var == 0.0 && empty.mc_var == 0.0);

  CHECK_THROWS(analyze({{-1, 1, 0.1}}, 0.0, market, Config{}));
  CHECK_THROWS(analyze(assets, -5.0, market, Config{}));
  Config bad;
  bad.confidence = 1.0;
  CHECK_THROWS(analyze(assets, 0.0, market, bad));
  bad = Config{};
  bad.horizon_days = 0;
  CHECK_THROWS(analyze(assets, 0.0, market, bad));
  bad = Config{};
  bad.simulations = 10;
  CHECK_THROWS(analyze(assets, 0.0, market, bad));
}

static void test_stress() {
  const std::vector<double> pnl = stress({1000, 2000, 500}, {-0.5, 0.1, -1.4});
  CHECK_NEAR(pnl[0], -500.0, 1e-12);
  CHECK_NEAR(pnl[1], 200.0, 1e-12);
  CHECK_NEAR(pnl[2], -500.0, 1e-12);  // capped at a total loss
  CHECK_THROWS(stress({1, 2}, {0.1}));
}

static void test_series_measures() {
  CHECK_NEAR(max_drawdown({100, 120, 90, 110, 80}), 40.0 / 120.0, 1e-12);
  CHECK_NEAR(max_drawdown({1, 2, 3}), 0.0, 1e-12);
  CHECK_THROWS(max_drawdown({1, 0}));

  // 100 returns from -0.50 to +0.49: the 95% VaR is the 6th worst, -0.45.
  std::vector<double> returns;
  for (int i = 0; i < 100; ++i) returns.push_back((i - 50) / 100.0);
  CHECK_NEAR(historical_var(returns, 0.95), 0.45, 1e-12);
  CHECK_NEAR(historical_cvar(returns, 0.95), 0.475, 1e-12);
  CHECK_THROWS(historical_var({}, 0.95));

  const std::vector<double> market = {0.01, -0.02, 0.015, 0.003, -0.007};
  std::vector<double> asset;
  for (double m : market) asset.push_back(2.0 * m + 0.001);
  CHECK_NEAR(beta(asset, market), 2.0, 1e-12);
  CHECK_THROWS(beta({0.1, 0.2}, {0.0, 0.0}));

  // Alternating +1% / -1%: sample variance is 0.0001 * n / (n - 1).
  const std::vector<double> flip = {0.01, -0.01, 0.01, -0.01};
  CHECK_NEAR(annualized_volatility(flip), std::sqrt(0.0001 * 4.0 / 3.0 * 252.0), 1e-12);
  CHECK_NEAR(sharpe_ratio(flip, 0.0), 0.0, 1e-12);
}

int main() {
  test_inverse_normal();
  test_cholesky();
  test_covariance();
  test_single_asset_closed_form();
  test_monte_carlo_matches_closed_form();
  test_risk_contributions();
  test_cash_and_horizon();
  test_determinism_and_edge_cases();
  test_stress();
  test_series_measures();
  if (failures == 0) std::printf("all risk engine tests passed\n");
  return failures == 0 ? 0 : 1;
}
