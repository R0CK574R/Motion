package com.motion.ledger;

/**
 * The four accounts every portfolio has. Entry amounts are signed: a debit is
 * positive and a credit is negative.
 */
public enum Account {
  /** Asset. Balance = cash on hand. */
  CASH,
  /** Asset, one sub-account per ticker. Balance = what the shares held cost. */
  SECURITIES,
  /** Money the owner has paid in, net of withdrawals. Carries a credit (negative) balance. */
  CONTRIBUTIONS,
  /** Gains and losses locked in by selling. A credit (negative) balance is a gain. */
  REALIZED_PNL
}
