-- Saved filters get a soft delete so deleting one is undoable (action log /
-- Ctrl+Z) instead of gated behind a confirm dialog. The name index becomes
-- partial so a deleted preset's name is free to reuse.
DROP INDEX `saved_filters_name_ux`;--> statement-breakpoint
ALTER TABLE `saved_filters` ADD `deleted_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `saved_filters_name_ux` ON `saved_filters` (`name`) WHERE "saved_filters"."deleted_at" is null;