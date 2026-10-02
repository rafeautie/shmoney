CREATE TABLE `action_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer NOT NULL,
	`trigger` text NOT NULL,
	`label` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `action_log` ADD `run_id` integer REFERENCES action_runs(id);--> statement-breakpoint
CREATE INDEX `action_log_run_ix` ON `action_log` (`run_id`);