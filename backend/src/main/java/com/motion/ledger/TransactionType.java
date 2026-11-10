package com.motion.ledger;

public enum TransactionType {
  DEPOSIT,
  WITHDRAWAL,
  BUY,
  SELL,
  /** Posted by the system to undo an earlier transaction. Clients cannot post it directly. */
  REVERSAL;

  public boolean isTrade() {
    return this == BUY || this == SELL;
  }
}
