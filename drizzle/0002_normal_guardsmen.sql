CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` integer NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `category_groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_group_name_ux` ON `categories` (`group_id`,`name`);--> statement-breakpoint
CREATE TABLE `category_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `category_groups_name_ux` ON `category_groups` (`name`);--> statement-breakpoint
ALTER TABLE `transactions` ADD `category_id` integer REFERENCES categories(id) ON DELETE SET NULL;