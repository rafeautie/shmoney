CREATE TABLE `rule_suggestions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`description_key` text NOT NULL,
	`category_id` integer NOT NULL,
	`match_count` integer NOT NULL,
	`source` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rule_suggestions_key_category_ux` ON `rule_suggestions` (`description_key`,`category_id`);