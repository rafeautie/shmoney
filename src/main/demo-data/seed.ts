import { and, eq, inArray, isNull, like, lt, sql } from 'drizzle-orm'
import { DEMO_TOKEN_PREFIX } from '@shared/demo'
import { LLM_MODELS, DEFAULT_MODEL_ID } from '@shared/llm'
import { DEFAULT_REPORT_FILTERS, reportCreateSchema } from '@shared/reports'
import { ruleConditionsSchema } from '@shared/rules'
import { savedFilterCreateSchema } from '@shared/transaction-filters'
import type { SettingKey } from '@shared/settings'
import { db } from '../db'
import { resetCategoriesToDefaults } from '../db/defaults'
import {
  accounts,
  actionLog,
  budgets,
  categories,
  chatMessages,
  connections,
  conversations,
  holdings,
  reports,
  reportWidgets,
  ruleSuggestions,
  rules,
  savedFilters,
  settings,
  transactions
} from '../db/schema'
import { encryptAccessUrl } from '../access-url'
import { syncConnection } from '../ipc/connections'
import { writeSetting } from '../settings-store'
import { runChatScript } from './chat'
import { monthKey } from './generate'
import { getDataset } from './index'
import type { CategoryRef, DatasetDefinition } from './types'

// every table a dataset writes, children before parents
const DATA_TABLES = [
  chatMessages,
  conversations,
  actionLog,
  ruleSuggestions,
  rules,
  budgets,
  reportWidgets,
  reports,
  savedFilters,
  holdings,
  transactions,
  accounts,
  connections
]
const DATA_TABLE_NAMES = [
  'chat_messages',
  'conversations',
  'action_log',
  'rule_suggestions',
  'rules',
  'budgets',
  'report_widgets',
  'reports',
  'saved_filters',
  'holdings',
  'transactions',
  'accounts',
  'connections'
]

// per-dataset state; display preferences (theme, blur, sidebar) survive a reset
const DATASET_SETTINGS: SettingKey[] = ['onboardingComplete', 'activitySeenAt']

/** Back to a fresh install: no data, default categories, preferences kept. */
export function clearData(): void {
  db.transaction((tx) => {
    for (const table of DATA_TABLES) tx.delete(table).run()
    tx.delete(settings).where(inArray(settings.key, DATASET_SETTINGS)).run()
    // restart ids so a seeded dataset lands on the same ids every time, which
    // keeps deep links like #/reports/1 stable for embeds
    tx.run(
      sql.raw(
        `DELETE FROM sqlite_sequence WHERE name IN (${DATA_TABLE_NAMES.map((n) => `'${n}'`).join(', ')})`
      )
    )
  })
  resetCategoriesToDefaults()
}

function categoryResolver(): (ref: CategoryRef) => number {
  const rows = db.select().from(categories).all()
  return (ref) => {
    const row =
      typeof ref === 'string'
        ? rows.find((c) => c.name === ref)
        : rows.find((c) => c.systemKey === ref.system)
    if (!row) throw new Error(`Demo dataset references unknown category ${JSON.stringify(ref)}`)
    return row.id
  }
}

function localDate(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * Replace everything with a sample dataset. The accounts arrive through the
 * real connect-and-sync path (a `demo:` token is its own bridge), so transfer
 * detection and rules-on-sync file them exactly as they would a bank's data.
 */
export async function seedDataset(id: string): Promise<void> {
  const dataset = getDataset(id)
  clearData()
  const category = categoryResolver()
  const now = new Date()
  const nowSec = Math.floor(now.getTime() / 1000)

  for (const [key, value] of Object.entries(dataset.settings ?? {})) {
    writeSetting(key as SettingKey, value as never)
  }

  dataset.rules?.forEach((rule, priority) => {
    db.insert(rules)
      .values({
        name: rule.name,
        priority,
        conditions: ruleConditionsSchema.parse({
          description: { op: 'contains', phrases: rule.phrases }
        }),
        action: { type: 'setCategory', categoryId: category(rule.category) },
        createdAt: nowSec,
        updatedAt: nowSec
      })
      .run()
  })

  db.insert(connections)
    .values({ accessUrlEncrypted: encryptAccessUrl(DEMO_TOKEN_PREFIX + id) })
    .run()
  await syncConnection()

  seedExtras(dataset, category, now)
}

function seedExtras(
  dataset: DatasetDefinition,
  category: (ref: CategoryRef) => number,
  now: Date
): void {
  const nowSec = Math.floor(now.getTime() / 1000)

  db.transaction((tx) => {
    if (dataset.manual) {
      const cutoff = nowSec - dataset.manual.olderThanDays * 24 * 60 * 60
      for (const { phrase, category: ref } of dataset.manual.entries) {
        tx.update(transactions)
          .set({ categoryId: category(ref) })
          .where(
            and(
              like(transactions.description, `%${phrase}%`),
              isNull(transactions.categoryId),
              eq(transactions.pending, false),
              lt(transactions.posted, cutoff)
            )
          )
          .run()
      }
    }

    for (const budget of dataset.budgets ?? []) {
      for (const fill of budget.fills) {
        tx.insert(budgets)
          .values({
            categoryId: category(budget.category),
            month: monthKey(now, -fill.monthsAgo),
            amount: fill.amount * 1000
          })
          .run()
      }
    }

    for (const { widgets = [], ...report } of dataset.reports ?? []) {
      const parsed = reportCreateSchema.parse({
        ...report,
        widgets: widgets.map(({ categories: refs, ...widget }) =>
          refs
            ? {
                ...widget,
                config: {
                  ...widget.config,
                  filters: {
                    ...widget.config.filters,
                    overrides: {
                      ...widget.config.filters.overrides,
                      categoryIds: refs.map(category)
                    }
                  }
                }
              }
            : widget
        )
      })
      const [row] = tx
        .insert(reports)
        .values({
          name: parsed.name,
          filters: parsed.filters ?? DEFAULT_REPORT_FILTERS,
          createdAt: nowSec,
          updatedAt: nowSec
        })
        .returning()
        .all()
      if (parsed.widgets?.length) {
        tx.insert(reportWidgets)
          .values(parsed.widgets.map((w) => ({ ...w, reportId: row.id })))
          .run()
      }
    }

    for (const saved of dataset.savedFilters ?? []) {
      const { categories: refs, ...filters } = saved.filters
      const parsed = savedFilterCreateSchema.parse({
        name: saved.name,
        filters: { ...filters, ...(refs ? { categoryIds: refs.map(category) } : {}) }
      })
      tx.insert(savedFilters)
        .values({ ...parsed, createdAt: nowSec, updatedAt: nowSec })
        .run()
    }

    for (const suggestion of dataset.suggestions ?? []) {
      const categoryId = category(suggestion.category)
      const matches = tx
        .select({ n: sql<number>`count(*)` })
        .from(transactions)
        .where(like(transactions.description, `%${suggestion.phrase}%`))
        .get()
      const sample = tx
        .select({ description: transactions.description })
        .from(transactions)
        .where(like(transactions.description, `%${suggestion.phrase}%`))
        .limit(1)
        .get()
      tx.insert(ruleSuggestions)
        .values({
          descriptionKey: sample?.description ?? suggestion.phrase,
          phrase: suggestion.phrase,
          categoryId,
          matchCount: matches?.n ?? 0,
          source: 'user',
          createdAt: nowSec,
          updatedAt: nowSec
        })
        .run()
    }
  })

  // outside the transaction: the scripts need the committed rows through the
  // chat tool's temp views
  const today = localDate(now)
  for (const script of dataset.chats ?? []) {
    const parts = runChatScript(script, today)
    const at = now.getTime() - script.hoursAgo * 60 * 60 * 1000
    const [conversation] = db
      .insert(conversations)
      .values({
        title: script.question,
        createdAt: at,
        updatedAt: at + 45_000,
        lastMessageAt: at + 45_000,
        modelLabel: LLM_MODELS[DEFAULT_MODEL_ID].label
      })
      .returning()
      .all()
    const [, reply] = db
      .insert(chatMessages)
      .values([
        {
          conversationId: conversation.id,
          role: 'user',
          parts: [{ type: 'text', text: script.question }],
          createdAt: at
        },
        {
          conversationId: conversation.id,
          role: 'assistant',
          parts,
          scope: { accountId: null, accountName: null },
          createdAt: at + 45_000
        }
      ])
      .returning({ id: chatMessages.id })
      .all()
    // already read, so no thread opens with an unread dot
    db.update(conversations)
      .set({ seenReplyId: reply.id })
      .where(eq(conversations.id, conversation.id))
      .run()
  }

  // the sync's automated Activity entries are part of the story, not news
  writeSetting('activitySeenAt', Date.now())
}
