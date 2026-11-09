package com.motion.ledger;

import com.motion.auth.CurrentUser;
import com.motion.ledger.LedgerService.PostResult;
import com.motion.ledger.LedgerService.TransactionView;
import com.motion.ledger.LedgerService.TrialBalance;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/ledger")
public class LedgerController {

  private final LedgerService ledger;

  public LedgerController(LedgerService ledger) {
    this.ledger = ledger;
  }

  /** Most recent transactions first, each with its debit and credit entries. */
  @GetMapping("/transactions")
  public Map<String, List<TransactionView>> list(
      @AuthenticationPrincipal Jwt jwt, @RequestParam(defaultValue = "50") int limit) {
    int capped = Math.max(1, Math.min(limit, 200));
    return Map.of("transactions", ledger.recent(CurrentUser.id(jwt), capped));
  }

  /**
   * Records a deposit, withdrawal, buy or sell. Returns 201 for a new
   * posting, or 200 with an Idempotent-Replay header when the
   * Idempotency-Key matched one made earlier.
   */
  @PostMapping("/transactions")
  public ResponseEntity<TransactionView> post(
      @AuthenticationPrincipal Jwt jwt,
      @RequestBody PostTransactionRequest request,
      @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey) {
    PostResult result = ledger.post(CurrentUser.id(jwt), request, idempotencyKey);
    if (result.replayed()) {
      return ResponseEntity.ok().header("Idempotent-Replay", "true").body(result.transaction());
    }
    return ResponseEntity.status(HttpStatus.CREATED).body(result.transaction());
  }

  /** Undoes a transaction by posting its mirror image. Nothing is deleted. */
  @PostMapping("/transactions/{id}/reversal")
  public ResponseEntity<TransactionView> reverse(
      @AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
    return ResponseEntity.status(HttpStatus.CREATED).body(ledger.reverse(CurrentUser.id(jwt), id));
  }

  @GetMapping("/trial-balance")
  public TrialBalance trialBalance(@AuthenticationPrincipal Jwt jwt) {
    return ledger.trialBalance(CurrentUser.id(jwt));
  }
}
