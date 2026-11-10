package com.motion.portfolio;

import com.motion.ledger.Account;
import com.motion.ledger.LedgerRepository;
import com.motion.ledger.LedgerRepository.HoldingRow;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The portfolio as the dashboard sees it. Nothing here is stored: cash,
 * holdings and gains are all computed by adding up ledger entries.
 */
@Service
public class PortfolioService {

  /**
   * @param cost average cost per share
   * @param basis total cost of the shares held
   * @param price latest known price (the last trade, unless the user updated it)
   */
  public record HoldingView(
      String id, String ticker, BigDecimal shares, BigDecimal cost, BigDecimal basis, BigDecimal price) {

    public BigDecimal value() {
      return shares.multiply(price);
    }
  }

  /**
   * @param contributions money paid in, net of withdrawals
   * @param realizedGain profit or loss locked in by selling
   */
  public record PortfolioView(
      BigDecimal cash, BigDecimal contributions, BigDecimal realizedGain, List<HoldingView> holdings) {

    public BigDecimal totalValue() {
      return holdings.stream().map(HoldingView::value).reduce(cash, BigDecimal::add);
    }
  }

  private final LedgerRepository repo;

  public PortfolioService(LedgerRepository repo) {
    this.repo = repo;
  }

  @Transactional(readOnly = true)
  public PortfolioView view(UUID userId) {
    Optional<UUID> portfolioId = repo.findPortfolio(userId);
    if (portfolioId.isEmpty()) {
      BigDecimal zero = BigDecimal.ZERO.setScale(2);
      return new PortfolioView(zero, zero, zero, List.of());
    }
    Map<Account, BigDecimal> balances = repo.balances(portfolioId.get());
    List<HoldingView> holdings =
        repo.holdings(portfolioId.get()).stream().map(PortfolioService::toView).toList();
    return new PortfolioView(
        balances.get(Account.CASH),
        balances.get(Account.CONTRIBUTIONS).negate(), // stored as a credit balance
        balances.get(Account.REALIZED_PNL).negate(),
        holdings);
  }

  private static HoldingView toView(HoldingRow row) {
    BigDecimal averageCost = row.basis().divide(row.quantity(), 4, RoundingMode.HALF_EVEN);
    BigDecimal price = row.price() == null ? averageCost : row.price();
    return new HoldingView(row.ticker(), row.ticker(), row.quantity(), averageCost, row.basis(), price);
  }
}
