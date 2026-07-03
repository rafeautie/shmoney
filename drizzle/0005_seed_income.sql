-- Seed the default ungrouped category. Runs exactly once; stays deleted if the
-- user removes it (Settings offers Reset to defaults).
-- Must stay in sync with DEFAULT_UNGROUPED_CATEGORIES in src/main/db/defaults.ts.
INSERT INTO `categories` (`group_id`, `name`) VALUES (NULL, '💵 Income');
