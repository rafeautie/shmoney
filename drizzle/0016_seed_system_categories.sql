-- Mark the seeded Income category as a system category and add Transfers.
-- System categories (system_key not null) back built-in behavior: Transfers
-- replaces the old is_transfer flag, Income anchors the default setup. They
-- can't be renamed, deleted, or removed by Reset to defaults.
-- Must stay in sync with SYSTEM_CATEGORIES in src/main/db/defaults.ts.
UPDATE `categories` SET `system_key` = 'income' WHERE `group_id` IS NULL AND `name` = '💵 Income';--> statement-breakpoint
INSERT INTO `categories` (`group_id`, `name`, `system_key`) VALUES (NULL, '🔄 Transfers', 'transfers');
