CREATE TABLE `action_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer NOT NULL,
	`source` text NOT NULL,
	`label` text NOT NULL,
	`changes` text NOT NULL,
	`undone_at` integer
);
--> statement-breakpoint
ALTER TABLE `transactions` ADD `is_transfer` integer DEFAULT false NOT NULL;