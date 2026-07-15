PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`connection_id` integer,
	`simplefin_id` text,
	`institution_name` text,
	`name` text NOT NULL,
	`currency` text NOT NULL,
	`balance` integer NOT NULL,
	`available_balance` integer,
	`balance_date` integer NOT NULL,
	`invert_balance` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_accounts`("id", "connection_id", "simplefin_id", "institution_name", "name", "currency", "balance", "available_balance", "balance_date", "invert_balance") SELECT "id", "connection_id", "simplefin_id", "institution_name", "name", "currency", "balance", "available_balance", "balance_date", "invert_balance" FROM `accounts`;--> statement-breakpoint
DROP TABLE `accounts`;--> statement-breakpoint
ALTER TABLE `__new_accounts` RENAME TO `accounts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_connection_sfid_ux` ON `accounts` (`connection_id`,`simplefin_id`);