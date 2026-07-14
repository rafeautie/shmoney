ALTER TABLE `categories` ADD `system_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `categories_system_key_ux` ON `categories` (`system_key`) WHERE "categories"."system_key" is not null;--> statement-breakpoint
ALTER TABLE `transactions` DROP COLUMN `is_transfer`;