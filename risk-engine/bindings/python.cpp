// Python bindings: exposes the engine as the `motion_risk` module.
#include <pybind11/pybind11.h>
#include <pybind11/stl.h>

#include "motion/risk.hpp"

namespace py = pybind11;
using namespace motion::risk;

PYBIND11_MODULE(motion_risk, m) {
  m.doc() = "Motion portfolio risk engine (C++17)";

  py::class_<Asset>(m, "Asset")
      .def(py::init([](double value, double beta, double idio_vol) {
             return Asset{value, beta, idio_vol};
           }),
           py::arg("value"), py::arg("beta"), py::arg("idio_vol"))
      .def_readwrite("value", &Asset::value)
      .def_readwrite("beta", &Asset::beta)
      .def_readwrite("idio_vol", &Asset::idio_vol);

  py::class_<Market>(m, "Market")
      .def(py::init([](double vol, double drift, double risk_free) {
             return Market{vol, drift, risk_free};
           }),
           py::arg("vol") = 0.16, py::arg("drift") = 0.08, py::arg("risk_free") = 0.04)
      .def_readwrite("vol", &Market::vol)
      .def_readwrite("drift", &Market::drift)
      .def_readwrite("risk_free", &Market::risk_free);

  py::class_<Config>(m, "Config")
      .def(py::init([](double confidence, int horizon_days, int simulations,
                       std::uint64_t seed, int histogram_bins) {
             Config c;
             c.confidence = confidence;
             c.horizon_days = horizon_days;
             c.simulations = simulations;
             c.seed = seed;
             c.histogram_bins = histogram_bins;
             return c;
           }),
           py::arg("confidence") = 0.95, py::arg("horizon_days") = 1,
           py::arg("simulations") = 20000, py::arg("seed") = 42,
           py::arg("histogram_bins") = 41);

  py::class_<Histogram>(m, "Histogram")
      .def_readonly("min", &Histogram::min)
      .def_readonly("max", &Histogram::max)
      .def_readonly("counts", &Histogram::counts);

  py::class_<Result>(m, "Result")
      .def_readonly("total_value", &Result::total_value)
      .def_readonly("invested_value", &Result::invested_value)
      .def_readonly("volatility", &Result::volatility)
      .def_readonly("beta", &Result::beta)
      .def_readonly("expected_return", &Result::expected_return)
      .def_readonly("sharpe", &Result::sharpe)
      .def_readonly("parametric_var", &Result::parametric_var)
      .def_readonly("parametric_cvar", &Result::parametric_cvar)
      .def_readonly("mc_var", &Result::mc_var)
      .def_readonly("mc_cvar", &Result::mc_cvar)
      .def_readonly("mc_worst", &Result::mc_worst)
      .def_readonly("mc_best", &Result::mc_best)
      .def_readonly("risk_contribution", &Result::risk_contribution)
      .def_readonly("histogram", &Result::histogram);

  // std::invalid_argument surfaces in Python as ValueError.
  m.def("analyze", &analyze, py::arg("assets"), py::arg("cash"), py::arg("market"),
        py::arg("config"));
  m.def("stress", &stress, py::arg("values"), py::arg("shocks"));
  m.def("historical_var", &historical_var, py::arg("returns"), py::arg("confidence"));
  m.def("historical_cvar", &historical_cvar, py::arg("returns"), py::arg("confidence"));
  m.def("max_drawdown", &max_drawdown, py::arg("prices"));
  m.def("annualized_volatility", &annualized_volatility, py::arg("daily_returns"));
  m.def("sharpe_ratio", &sharpe_ratio, py::arg("daily_returns"), py::arg("annual_risk_free"));
  m.def("beta", &beta, py::arg("asset_returns"), py::arg("market_returns"));
  m.def("inverse_normal_cdf", &inverse_normal_cdf, py::arg("p"));
}
