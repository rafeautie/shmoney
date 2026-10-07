CREATE TABLE `deleted_sync_accounts` (
	`simplefin_id` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO `deleted_sync_accounts` (`simplefin_id`) SELECT `value` FROM `connections`, json_each(`connections`.`deleted_account_ids`);
--> statement-breakpoint
ALTER TABLE `connections` DROP COLUMN `deleted_account_ids`;
