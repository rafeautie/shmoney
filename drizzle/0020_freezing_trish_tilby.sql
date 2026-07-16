DROP INDEX `rule_suggestions_key_category_ux`;--> statement-breakpoint
ALTER TABLE `rule_suggestions` ADD `phrase` text NOT NULL DEFAULT '';--> statement-breakpoint
UPDATE `rule_suggestions` SET `phrase` = `description_key`;--> statement-breakpoint
CREATE UNIQUE INDEX `rule_suggestions_phrase_category_ux` ON `rule_suggestions` (`phrase`,`category_id`);
