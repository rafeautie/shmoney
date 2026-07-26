-- Balances are now derived as anchor + sum(transactions after balance_date).
-- Manual accounts (connection_id IS NULL) stored a *current* balance typed at
-- import time with balance_date = now, so their imported history sat before the
-- anchor and counted for nothing. Re-anchor them at the epoch, where the stored
-- balance means an opening balance and every transaction counts.
--
-- Back-solving rather than zeroing keeps the displayed number identical across
-- the upgrade: subtracting the transactions that were already baked into the old
-- anchor leaves an opening balance that re-derives to exactly what it was.
-- The predicate must match balanceDeltas() in src/main/accounts/balance.ts.
UPDATE `accounts`
SET `balance` = `balance` - coalesce((
      SELECT sum(t.`amount`) FROM `transactions` t
      WHERE t.`account_id` = `accounts`.`id`
        AND t.`deleted_at` IS NULL
        AND t.`pending` = 0
        AND coalesce(nullif(t.`posted`, 0), t.`transacted_at`, 0) <= `accounts`.`balance_date`
    ), 0),
    `balance_date` = 0
WHERE `connection_id` IS NULL;
