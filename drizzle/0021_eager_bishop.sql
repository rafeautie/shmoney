CREATE TABLE `chat_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` integer NOT NULL,
	`role` text NOT NULL,
	`parts` text NOT NULL,
	`status` text DEFAULT 'complete' NOT NULL,
	`error_message` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_messages_conversation_ix` ON `chat_messages` (`conversation_id`,`id`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_message_at` integer,
	`deleted_at` integer,
	`model_label` text NOT NULL
);
