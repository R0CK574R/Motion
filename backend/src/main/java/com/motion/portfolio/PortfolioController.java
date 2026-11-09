package com.motion.portfolio;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.motion.auth.CurrentUser;
import com.motion.ledger.LedgerService;
import com.motion.portfolio.PortfolioService.PortfolioView;
import java.math.BigDecimal;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/portfolio")
public class PortfolioController {

  @JsonIgnoreProperties(ignoreUnknown = true)
  public record PriceUpdate(BigDecimal price) {}

  private final PortfolioService portfolio;
  private final LedgerService ledger;

  public PortfolioController(PortfolioService portfolio, LedgerService ledger) {
    this.portfolio = portfolio;
    this.ledger = ledger;
  }

  /** Cash and holdings, derived from the ledger. There is no way to edit them directly. */
  @GetMapping
  public PortfolioView get(@AuthenticationPrincipal Jwt jwt) {
    return portfolio.view(CurrentUser.id(jwt));
  }

  /** Updates the latest known price of a ticker the caller holds. */
  @PutMapping("/prices/{ticker}")
  public PortfolioView setPrice(
      @AuthenticationPrincipal Jwt jwt, @PathVariable String ticker, @RequestBody PriceUpdate body) {
    ledger.setPrice(CurrentUser.id(jwt), ticker, body.price(), true);
    return portfolio.view(CurrentUser.id(jwt));
  }
}
