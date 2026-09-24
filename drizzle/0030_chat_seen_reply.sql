ALTER TABLE `conversations` ADD `seen_reply_id` integer;--> statement-breakpoint
UPDATE `conversations` SET `seen_reply_id` = (SELECT max(`id`) FROM `chat_messages` WHERE `chat_messages`.`conversation_id` = `conversations`.`id` AND `chat_messages`.`role` = 'assistant');
