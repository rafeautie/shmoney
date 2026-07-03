CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`connection_id` integer NOT NULL,
	`simplefin_id` text NOT NULL,
	`institution_name` text,
	`name` text NOT NULL,
	`currency` text NOT NULL,
	`balance` integer NOT NULL,
	`available_balance` integer,
	`balance_date` integer NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_connection_sfid_ux` ON `accounts` (`connection_id`,`simplefin_id`);--> statement-breakpoint
CREATE TABLE `connections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`access_url_encrypted` text NOT NULL,
	`last_synced_at` integer,
	`created_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`simplefin_id` text NOT NULL,
	`posted` integer NOT NULL,
	`amount` integer NOT NULL,
	`description` text NOT NULL,
	`pending` integer DEFAULT false NOT NULL,
	`transacted_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_account_sfid_ux` ON `transactions` (`account_id`,`simplefin_id`);