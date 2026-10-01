CREATE TABLE `llm_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer NOT NULL,
	`model_id` text NOT NULL,
	`feature` text NOT NULL,
	`stop_reason` text NOT NULL,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`decode_tokens` integer NOT NULL,
	`decode_ms` integer NOT NULL,
	`prefill_ms` integer NOT NULL,
	`tool_ms` integer NOT NULL,
	`total_ms` integer NOT NULL,
	`ttft_ms` integer,
	`load_ms` integer
);
--> statement-breakpoint
CREATE INDEX `llm_usage_created_ix` ON `llm_usage` (`created_at`);--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `stats` text;