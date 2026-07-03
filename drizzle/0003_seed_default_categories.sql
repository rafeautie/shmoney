-- Seed the default category groups and categories. Runs exactly once; if the
-- user deletes these they stay deleted (Settings offers Reset to defaults).
-- Must stay in sync with DEFAULT_CATEGORY_GROUPS in src/main/db/defaults.ts.
INSERT INTO `category_groups` (`id`, `name`) VALUES (1, '🎉 Wants'), (2, '📌 Needs'), (3, '💰 Savings & Debt');--> statement-breakpoint
INSERT INTO `categories` (`group_id`, `name`) VALUES
(1, '📺 Subscriptions'), (1, '🛍️ Shopping'), (1, '🎨 Hobbies'), (1, '🎬 Entertainment'), (1, '🍽️ Dining Out'),
(2, '💡 Utilities'), (2, '🚗 Transportation'), (2, '🛡️ Insurance'), (2, '🏠 Housing'), (2, '⚕️ Healthcare'), (2, '🛒 Groceries'),
(3, '🏖️ Retirement'), (3, '📈 Investments'), (3, '🚨 Emergency Fund'), (3, '💳 Debt Payments');
