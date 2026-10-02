CREATE TABLE `action_log_transactions` (
	`entry_id` integer NOT NULL,
	`transaction_id` integer NOT NULL,
	PRIMARY KEY(`entry_id`, `transaction_id`),
	FOREIGN KEY (`entry_id`) REFERENCES `action_log`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `action_log_transactions_tx_ix` ON `action_log_transactions` (`transaction_id`);--> statement-breakpoint
ALTER TABLE `action_log` ADD `search_text` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `action_log_undone_ix` ON `action_log` (`undone_at`) WHERE "action_log"."undone_at" is not null;--> statement-breakpoint
ALTER TABLE `transactions` ADD `effective_date` integer GENERATED ALWAYS AS (coalesce(nullif("posted", 0), "transacted_at", 0)) VIRTUAL NOT NULL;--> statement-breakpoint
CREATE INDEX `transactions_date_ix` ON `transactions` (`effective_date`,`id`) WHERE "transactions"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX `transactions_account_date_ix` ON `transactions` (`account_id`,`effective_date`,`id`) WHERE "transactions"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX `transactions_category_ix` ON `transactions` (`category_id`);--> statement-breakpoint
CREATE INDEX `chat_messages_status_ix` ON `chat_messages` (`status`);--> statement-breakpoint
-- backfill Activity search; recordAction keeps both current from here on. A
-- change's name (or else title) is searched as text; a change without one is
-- searched by its transaction's current description.
UPDATE `action_log` SET `search_text` = coalesce((
	SELECT group_concat(coalesce(json_extract(j.value, '$.name'), json_extract(j.value, '$.title')), char(10))
	FROM json_each(`action_log`.`changes`) j
), '');--> statement-breakpoint
INSERT OR IGNORE INTO `action_log_transactions` (`entry_id`, `transaction_id`)
SELECT a.`id`, json_extract(j.value, '$.transactionId')
FROM `action_log` a, json_each(a.`changes`) j
WHERE json_extract(j.value, '$.transactionId') IS NOT NULL
	AND coalesce(json_extract(j.value, '$.name'), json_extract(j.value, '$.title')) IS NULL;
