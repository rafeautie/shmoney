-- A manual account's opening balance becomes a real transaction, so its ledger
-- adds up to its balance instead of the starting figure living in a column
-- nothing on the page explains. Manual accounts hold complete history by
-- construction, so they need no anchor at all: balance is now just the sum of
-- their transactions, and the opening balance is the first of them.
--
-- Starting balance is a system category so reports, budgets and the chat `tx`
-- view can exclude it. It is account setup, not activity — counted as income it
-- would swamp every spending report.
-- Must stay in sync with SYSTEM_CATEGORIES in src/main/db/defaults.ts.
INSERT INTO `categories` (`group_id`, `name`, `system_key`) VALUES (NULL, '🏦 Starting balance', 'opening');--> statement-breakpoint
-- Dated a day before the account's earliest transaction so it sorts first
-- (falling back to now for an account that somehow has none). Carries the
-- manual: prefix, which marks it user-owned: editable, deletable, undoable.
INSERT INTO `transactions` (`account_id`, `simplefin_id`, `posted`, `amount`, `description`, `category_id`, `pending`)
SELECT a.`id`,
       'manual:opening:' || a.`id`,
       coalesce((
         SELECT min(coalesce(nullif(t.`posted`, 0), t.`transacted_at`))
         FROM `transactions` t
         WHERE t.`account_id` = a.`id` AND t.`deleted_at` IS NULL
       ), CAST(strftime('%s', 'now') AS INTEGER)) - 86400,
       a.`balance`,
       'Starting balance',
       (SELECT `id` FROM `categories` WHERE `system_key` = 'opening'),
       0
FROM `accounts` a
WHERE a.`connection_id` IS NULL AND a.`balance` <> 0;--> statement-breakpoint
-- the anchor is now carried by the transaction above, so zeroing it keeps every
-- derived balance identical across the upgrade
UPDATE `accounts` SET `balance` = 0 WHERE `connection_id` IS NULL;
