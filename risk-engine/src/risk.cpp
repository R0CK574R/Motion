#include "motion/risk.hpp"

#include <algorithm>
#include <cmath>
#include <numeric>
#include <random>
#include <stdexcept>

namespace motion::risk {
namespace {

constexpr double kPi = 3.14159265358979323846;

double normal_pdf(double x) { return std::exp(-0.5 * x * x) / std::sqrt(2.0 * kPi); }

double mean(const std::vector<double>& v) {
  return std::accumulate(v.begin(), v.end(), 0.0) / static_cast<double>(v.size());
}

// Sample variance (divides by n - 1).
double variance(const std::vector<double>& v) {
  const double m = mean(v);
  double sum = 0.0;
  for (double x : v) sum += (x - m) * (x - m);
  return sum / static_cast<double>(v.size() - 1);
}

void require(bool ok, const char* message) {
  if (!ok) throw std::invalid_argument(message);
}

// Standard normal draws from a 64-bit Mersenne Twister via Box-Muller.
// std::normal_distribution is avoided on purpose: its output differs between
// standard libraries, and risk numbers must be reproducible everywhere.
class NormalSource {
 public:
  explicit NormalSource(std::uint64_t seed) : rng_(seed) {}

  double next() {
    if (has_spare_) {
      has_spare_ = false;
      return spare_;
    }
    double u1 = uniform();
    while (u1 <= 0.0) u1 = uniform();  // log(0) guard
    const double u2 = uniform();
    const double radius = std::sqrt(-2.0 * std::log(u1));
    const double angle = 2.0 * kPi * u2;
    spare_ = radius * std::sin(angle);
    has_spare_ = true;
    return radius * std::cos(angle);
  }

 private:
  // Top 53 bits of the generator, scaled to [0, 1).
  double uniform() { return static_cast<double>(rng_() >> 11) * (1.0 / 9007199254740992.0); }

  std::mt19937_64 rng_;
  double spare_ = 0.0;
  bool has_spare_ = false;
};

// Index of the VaR observation in an ascending-sorted sample of size n.
std::size_t tail_index(std::size_t n, double confidence) {
  const auto idx = static_cast<std::size_t>(std::floor((1.0 - confidence) * static_cast<double>(n)));
  return std::min(idx, n - 1);
}

}  // namespace

double inverse_normal_cdf(double p) {
  require(p > 0.0 && p < 1.0, "probability must be between 0 and 1");
  static const double a[] = {-3.969683028665376e+01, 2.209460984245205e+02,
                             -2.759285104469687e+02, 1.383577518672690e+02,
                             -3.066479806614716e+01, 2.506628277459239e+00};
  static const double b[] = {-5.447609879822406e+01, 1.615858368580409e+02,
                             -1.556989798598866e+02, 6.680131188771972e+01,
                             -1.328068155288572e+01};
  static const double c[] = {-7.784894002430293e-03, -3.223964580411365e-01,
                             -2.400758277161838e+00, -2.549732539343734e+00,
                             4.374664141464968e+00,  2.938163982698783e+00};
  static const double d[] = {7.784695709041462e-03, 3.224671290700398e-01,
                             2.445134137142996e+00, 3.754408661907416e+00};
  const double low = 0.02425;
  if (p < low) {
    const double q = std::sqrt(-2.0 * std::log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
           ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0);
  }
  if (p > 1.0 - low) {
    const double q = std::sqrt(-2.0 * std::log(1.0 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
           ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0);
  }
  const double q = p - 0.5;
  const double r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
         (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1.0);
}

std::vector<double> covariance(const std::vector<Asset>& assets, const Market& market) {
  const std::size_t n = assets.size();
  const double market_var = market.vol * market.vol;
  std::vector<double> cov(n * n);
  for (std::size_t i = 0; i < n; ++i) {
    for (std::size_t j = 0; j < n; ++j) {
      cov[i * n + j] = assets[i].beta * assets[j].beta * market_var;
    }
    cov[i * n + i] += assets[i].idio_vol * assets[i].idio_vol;
  }
  return cov;
}

std::vector<double> cholesky(const std::vector<double>& a, int n) {
  require(n >= 0 && a.size() == static_cast<std::size_t>(n) * n, "matrix must be n x n");
  std::vector<double> l(a.size(), 0.0);
  for (int i = 0; i < n; ++i) {
    for (int j = 0; j <= i; ++j) {
      double sum = a[i * n + j];
      for (int k = 0; k < j; ++k) sum -= l[i * n + k] * l[j * n + k];
      if (i == j) {
        // A tiny negative pivot is rounding error on a semi-definite matrix
        // (for example two perfectly correlated assets); a large one is not.
        const double tolerance = 1e-10 * std::max(1.0, std::abs(a[i * n + i]));
        require(sum > -tolerance, "matrix is not positive semi-definite");
        l[i * n + i] = sum > 0.0 ? std::sqrt(sum) : 0.0;
      } else {
        const double pivot = l[j * n + j];
        l[i * n + j] = pivot > 0.0 ? sum / pivot : 0.0;
      }
    }
  }
  return l;
}

Result analyze(const std::vector<Asset>& assets, double cash,
               const Market& market, const Config& config) {
  require(cash >= 0.0, "cash must not be negative");
  require(config.confidence > 0.5 && config.confidence < 1.0, "confidence must be in (0.5, 1)");
  require(config.horizon_days >= 1, "horizon must be at least one day");
  require(config.simulations >= 100, "at least 100 simulations are required");
  require(config.histogram_bins >= 1, "histogram needs at least one bin");
  require(market.vol >= 0.0, "market volatility must not be negative");
  for (const Asset& asset : assets) {
    require(asset.value >= 0.0, "position values must not be negative");
    require(asset.idio_vol >= 0.0, "volatility must not be negative");
  }

  const int n = static_cast<int>(assets.size());
  Result result;
  result.risk_contribution.assign(n, 0.0);
  for (const Asset& asset : assets) result.invested_value += asset.value;
  result.total_value = result.invested_value + cash;
  result.histogram.counts.assign(config.histogram_bins, 0);
  if (result.total_value <= 0.0 || n == 0) return result;

  // Everything below works in currency: the "exposure" of asset i is its
  // value, so the portfolio's P&L variance is  v^T * Cov * v.
  const std::vector<double> cov = covariance(assets, market);
  std::vector<double> cov_times_value(n, 0.0);
  double variance_ccy = 0.0;  // annualised, in currency squared
  for (int i = 0; i < n; ++i) {
    for (int j = 0; j < n; ++j) cov_times_value[i] += cov[i * n + j] * assets[j].value;
    variance_ccy += assets[i].value * cov_times_value[i];
  }
  if (variance_ccy > 0.0) {
    for (int i = 0; i < n; ++i) {
      result.risk_contribution[i] = assets[i].value * cov_times_value[i] / variance_ccy;
    }
  }

  // CAPM: an asset earns the risk-free rate plus beta times the market premium.
  const double premium = market.drift - market.risk_free;
  std::vector<double> drift(n);
  double drift_ccy = 0.0;  // annualised expected P&L of the positions
  double beta_ccy = 0.0;
  for (int i = 0; i < n; ++i) {
    drift[i] = market.risk_free + assets[i].beta * premium;
    drift_ccy += assets[i].value * drift[i];
    beta_ccy += assets[i].value * assets[i].beta;
  }

  const double sigma_ccy = std::sqrt(variance_ccy);
  result.volatility = sigma_ccy / result.total_value;
  result.beta = beta_ccy / result.total_value;
  result.expected_return = (drift_ccy + cash * market.risk_free) / result.total_value;
  result.sharpe = result.volatility > 0.0
                      ? (result.expected_return - market.risk_free) / result.volatility
                      : 0.0;

  // Scale to the horizon: mean grows with time, volatility with its root.
  const double years = config.horizon_days / kTradingDays;
  const double horizon_mean = drift_ccy * years;
  const double horizon_sigma = sigma_ccy * std::sqrt(years);
  const double tail = 1.0 - config.confidence;
  const double z = inverse_normal_cdf(config.confidence);
  result.parametric_var = std::max(0.0, z * horizon_sigma - horizon_mean);
  result.parametric_cvar = std::max(0.0, horizon_sigma * normal_pdf(z) / tail - horizon_mean);

  // Monte Carlo. Correlated shocks are L * z, where L is the Cholesky factor
  // of the covariance matrix and z is a vector of independent normals.
  const std::vector<double> l = cholesky(cov, n);
  const double root_years = std::sqrt(years);
  NormalSource normals(config.seed);
  std::vector<double> pnl(config.simulations);
  std::vector<double> draws(n);
  for (double& outcome : pnl) {
    for (double& draw : draws) draw = normals.next();
    double total = 0.0;
    for (int i = 0; i < n; ++i) {
      double shock = 0.0;
      for (int k = 0; k <= i; ++k) shock += l[i * n + k] * draws[k];
      total += assets[i].value * (drift[i] * years + shock * root_years);
    }
    outcome = total;
  }
  std::sort(pnl.begin(), pnl.end());
  const std::size_t cut = tail_index(pnl.size(), config.confidence);
  result.mc_var = std::max(0.0, -pnl[cut]);
  double tail_sum = 0.0;
  for (std::size_t i = 0; i <= cut; ++i) tail_sum += pnl[i];
  result.mc_cvar = std::max(0.0, -tail_sum / static_cast<double>(cut + 1));
  result.mc_worst = pnl.front();
  result.mc_best = pnl.back();

  result.histogram.min = pnl.front();
  result.histogram.max = pnl.back();
  const double width = (pnl.back() - pnl.front()) / config.histogram_bins;
  for (double outcome : pnl) {
    int bin = width > 0.0 ? static_cast<int>((outcome - pnl.front()) / width) : 0;
    bin = std::clamp(bin, 0, config.histogram_bins - 1);
    ++result.histogram.counts[bin];
  }
  return result;
}

std::vector<double> stress(const std::vector<double>& values,
                           const std::vector<double>& shocks) {
  require(values.size() == shocks.size(), "values and shocks must have the same length");
  std::vector<double> pnl(values.size());
  for (std::size_t i = 0; i < values.size(); ++i) {
    // A long position cannot lose more than everything.
    pnl[i] = values[i] * std::max(shocks[i], -1.0);
  }
  return pnl;
}

double historical_var(std::vector<double> returns, double confidence) {
  require(!returns.empty(), "returns must not be empty");
  require(confidence > 0.5 && confidence < 1.0, "confidence must be in (0.5, 1)");
  std::sort(returns.begin(), returns.end());
  return std::max(0.0, -returns[tail_index(returns.size(), confidence)]);
}

double historical_cvar(std::vector<double> returns, double confidence) {
  require(!returns.empty(), "returns must not be empty");
  require(confidence > 0.5 && confidence < 1.0, "confidence must be in (0.5, 1)");
  std::sort(returns.begin(), returns.end());
  const std::size_t cut = tail_index(returns.size(), confidence);
  double sum = 0.0;
  for (std::size_t i = 0; i <= cut; ++i) sum += returns[i];
  return std::max(0.0, -sum / static_cast<double>(cut + 1));
}

double max_drawdown(const std::vector<double>& prices) {
  double peak = 0.0;
  double worst = 0.0;
  for (double price : prices) {
    require(price > 0.0, "prices must be positive");
    peak = std::max(peak, price);
    worst = std::max(worst, (peak - price) / peak);
  }
  return worst;
}

double annualized_volatility(const std::vector<double>& daily_returns) {
  require(daily_returns.size() >= 2, "at least two returns are required");
  return std::sqrt(variance(daily_returns) * kTradingDays);
}

double sharpe_ratio(const std::vector<double>& daily_returns, double annual_risk_free) {
  const double vol = annualized_volatility(daily_returns);
  if (vol <= 0.0) return 0.0;
  return (mean(daily_returns) * kTradingDays - annual_risk_free) / vol;
}

double beta(const std::vector<double>& asset_returns,
            const std::vector<double>& market_returns) {
  require(asset_returns.size() == market_returns.size(), "series must have the same length");
  require(asset_returns.size() >= 2, "at least two returns are required");
  const double asset_mean = mean(asset_returns);
  const double market_mean = mean(market_returns);
  double cov = 0.0;
  double var = 0.0;
  for (std::size_t i = 0; i < asset_returns.size(); ++i) {
    cov += (asset_returns[i] - asset_mean) * (market_returns[i] - market_mean);
    var += (market_returns[i] - market_mean) * (market_returns[i] - market_mean);
  }
  require(var > 0.0, "market returns have no variance");
  return cov / var;
}

}  // namespace motion::risk
