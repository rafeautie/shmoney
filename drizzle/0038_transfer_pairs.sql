ALTER TABLE `transactions` ADD `transfer_pair_id` integer REFERENCES transactions(id) ON DELETE set null;
--> statement-breakpoint
WITH `legs` AS (
	SELECT `t`.`id`, `t`.`account_id`, `t`.`amount`, `t`.`effective_date` AS `day`, `a`.`currency`
	FROM `transactions` `t`
	JOIN `accounts` `a` ON `a`.`id` = `t`.`account_id`
	JOIN `categories` `c` ON `c`.`id` = `t`.`category_id`
	WHERE `c`.`system_key` = 'transfers' AND `t`.`deleted_at` IS NULL AND `t`.`pending` = 0 AND `t`.`amount` != 0
), `edges` AS (
	SELECT `x`.`id` AS `a`, `y`.`id` AS `b`
	FROM `legs` `x`
	JOIN `legs` `y` ON `y`.`amount` = -`x`.`amount` AND `y`.`currency` = `x`.`currency`
		AND `y`.`account_id` != `x`.`account_id` AND abs(`y`.`day` - `x`.`day`) <= 259200
), `single` AS (
	SELECT `a` FROM `edges` GROUP BY `a` HAVING count(*) = 1
)
UPDATE `transactions`
SET `transfer_pair_id` = (SELECT `b` FROM `edges` WHERE `edges`.`a` = `transactions`.`id`)
WHERE `id` IN (
	SELECT `e`.`a` FROM `edges` `e`
	JOIN `single` `s1` ON `s1`.`a` = `e`.`a`
	JOIN `single` `s2` ON `s2`.`a` = `e`.`b`
);
