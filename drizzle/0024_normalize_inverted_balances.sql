-- invert_balance is being removed (see the next migration). It was a read-time
-- display flip for institutions that report a balance with the wrong sign, which
-- left the stored column in the institution's sign convention while
-- transactions.amount uses the app's (negative = money out). Balances are about
-- to be derived as anchor + sum(transactions after balance_date), so the anchor
-- has to be normalized first or the delta would be added in the wrong direction.
-- Negating here also keeps every displayed number identical across the upgrade.
-- -NULL is NULL in SQLite, so a null available_balance survives untouched.
UPDATE `accounts` SET `balance` = -`balance`, `available_balance` = -`available_balance` WHERE `invert_balance` = 1;
