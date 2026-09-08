-- Savings goals. Progress is derived from transactions, never stored.
CREATE TABLE `savings_goals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`mode` text NOT NULL,
	`target_amount` integer NOT NULL,
	`target_date` text,
	`started_at` integer NOT NULL,
	`baseline_amount` integer DEFAULT 0 NOT NULL,
	`currency` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE TABLE `savings_goal_accounts` (
	`goal_id` integer NOT NULL,
	`account_id` integer NOT NULL,
	PRIMARY KEY(`goal_id`, `account_id`),
	FOREIGN KEY (`goal_id`) REFERENCES `savings_goals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
