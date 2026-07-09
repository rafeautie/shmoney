CREATE TABLE `holdings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`simplefin_id` text NOT NULL,
	`symbol` text NOT NULL,
	`description` text NOT NULL,
	`currency` text NOT NULL,
	`shares` text NOT NULL,
	`market_value` integer NOT NULL,
	`cost_basis` integer NOT NULL,
	`purchase_price` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `holdings_account_sfid_ux` ON `holdings` (`account_id`,`simplefin_id`);