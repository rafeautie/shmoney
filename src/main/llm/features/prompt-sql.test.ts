import type { DatabaseSync } from 'node:sqlite'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { scopeViewsDdl } from '../tools/sql-tool'
import { migratedDb, seedGoalTables } from '../test-db'
import type { PromptDbContext } from './chat'
import { monthSpanLines } from '../system-prompt'

// chat.ts reaches Electron through these modules; stub them so the prompt
// builder stays loadable (same pattern as chat.test.ts)
vi.mock('../../db', () => ({ db: {} }))
vi.mock('../../logging', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}))
vi.mock('../manager', () => ({ llmManager: {}, sendToRenderer: vi.fn() }))
vi.mock('../queue', () => ({ enqueueGenerate: vi.fn() }))

const { buildSystemPrompt } = await import('./chat')

/**
 * The system prompt's recipes are the model's working memory for SQL: a small
 * model adapts a fragment it can see far more reliably than one it derives, so
 * a recipe that doesn't run is worse than no recipe at all. These tests EXECUTE
 * every SQL fragment in the prompt against the real schema behind the real
 * scope views, rather than string-matching it.
 *
 * The fragments are extracted from the built prompt rather than transcribed
 * here, so editing a recipe re-tests the edit instead of testing a stale copy.
 *
 * This exists because of a shipped bug: the pivot recipe named its columns
 * after the group ("AS dining"), the model pivoted by month instead, and the
 * derived alias `spending_2026-06` was a syntax error. Hence SAFE_IDENTIFIER
 * below, which holds every recipe to the naming rule the model can only infer
 * from them.
 */

const CTX: PromptDbContext = {
  accounts: [
    { name: 'Chase Checking', currency: 'USD' },
    { name: 'Amex 💳 Card', currency: 'USD' }
  ],
  categories: [
    { group: '🎉 Wants', names: ['🍽️ Dining Out'] },
    { group: '📌 Needs', names: ['🛒 Groceries'] }
  ],
  dateRange: { min: '2026-01-01', max: '2026-07-31' }
}

const SCOPE = { accountId: null, accountName: null }

const PROMPT = buildSystemPrompt(SCOPE, CTX)

// A fragment starts at a line opening a statement and runs while the following
// lines continue it: indented, or opening a clause. Prose resumes at a line
// that does neither ("Then chart it with x day..."), which ends the fragment.
const SQL_START = /^(WITH|SELECT)\b/
const SQL_CONT = /^(\s|\)|SELECT|FROM|WHERE|GROUP|ORDER|LIMIT|HAVING|JOIN|LEFT|INNER|UNION|WITH)/

function sqlFragments(prompt: string): string[] {
  const lines = prompt.split('\n')
  const blocks: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (!SQL_START.test(lines[i])) continue
    const block = [lines[i]]
    while (i + 1 < lines.length && lines[i + 1].trim() !== '' && SQL_CONT.test(lines[i + 1]))
      block.push(lines[++i])
    blocks.push(block.join('\n'))
  }
  return blocks
}

// every fragment is a whole runnable statement: tx is a real scope view now,
// so no recipe needs a base CTE pasted in before it executes
const RECIPES = sqlFragments(PROMPT)

// the categories the migrations seed by default, which are also the ones the
// prompt's recipes LIKE-match; using them keeps the emoji in play, since a
// filter that drops the emoji matches nothing
const DINING = 5 // 🍽️ Dining Out
const GROCERIES = 11 // 🛒 Groceries
const TRANSFERS = 17 // 🔄 Transfers, system_key = 'transfers'

function seed(db: DatabaseSync): void {
  // local midday, so the calendar date is TZ-stable for offsets up to ±11h
  const day = (month: number, dayOfMonth: number): number =>
    Math.floor(Date.UTC(2026, month - 1, dayOfMonth, 12) / 1000)
  db.exec(`
    INSERT INTO accounts (id, name, currency, balance, available_balance, balance_date)
    VALUES (1, 'Chase Checking', 'USD', 1234560, 1000000, 0),
           (2, 'Amex 💳 Card', 'EUR', 250000, NULL, 0);
    INSERT INTO transactions (id, account_id, simplefin_id, posted, amount, description, pending,
                              transacted_at, category_id)
    VALUES (1, 1, 't1', ${day(6, 3)}, -12340, 'Coffee', 0, ${day(6, 3)}, ${DINING}),
           (2, 1, 't2', ${day(6, 3)}, -8000, 'Market', 0, ${day(6, 3)}, ${GROCERIES}),
           (3, 1, 't3', ${day(6, 15)}, 500000, 'Paycheck', 0, ${day(6, 15)}, NULL),
           (4, 1, 't4', ${day(7, 3)}, -25000, 'Dinner', 0, ${day(7, 3)}, ${DINING}),
           (5, 1, 't5', ${day(7, 20)}, -3000, 'Snacks', 0, ${day(7, 20)}, NULL),
           (6, 2, 't6', ${day(5, 9)}, -4500, 'Euro lunch', 0, ${day(5, 9)}, ${DINING}),
           (7, 1, 't7', ${day(7, 21)}, -99000, 'Moved to savings', 0, ${day(7, 21)}, ${TRANSFERS}),
           (8, 1, 't8', 0, -5000, 'Pending', 1, ${day(7, 22)}, ${DINING}),
           (9, 1, 't9', 0, -2000, 'Undated', 0, 0, ${DINING}),
           -- on the last day of a month, which is where a 'YYYY-MM-DD' upper
           -- endpoint against a timed column silently loses rows
           (10, 1, 't10', ${day(7, 31)}, -7000, 'Last day', 0, ${day(7, 31)}, ${GROCERIES}),
           -- a steady monthly charge, for the recurring-charges recipe
           (11, 1, 't11', ${day(5, 10)}, -15490, 'Streamy', 0, ${day(5, 10)}, NULL),
           (12, 1, 't12', ${day(6, 10)}, -15490, 'Streamy', 0, ${day(6, 10)}, NULL),
           (13, 1, 't13', ${day(7, 10)}, -15490, 'Streamy', 0, ${day(7, 10)}, NULL);
    INSERT INTO budgets (category_id, month, amount) VALUES (${DINING}, '2026-07', 150000);
  `)
}

function open(): DatabaseSync {
  const db = migratedDb()
  seed(db)
  for (const ddl of scopeViewsDdl({ accountId: null })) db.exec(ddl)
  seedGoalTables(db)
  return db
}

/**
 * What SQLite will accept unquoted. A column alias derived from a VALUE rather
 * than written as a word (a month, a quarter label, an account name) lands
 * outside this, and the model does not reach for double quotes.
 */
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

describe('system prompt SQL', () => {
  let db: DatabaseSync
  beforeAll(() => {
    db = open()
  })

  it('extracts every recipe from the prompt', () => {
    // bump deliberately when adding a recipe, and add its assertions below;
    // this is what stops a new recipe from shipping unexecuted
    expect(RECIPES).toHaveLength(1)
  })

  it('counts uncategorized purchases, the fallback turn', () => {
    const [row] = db.prepare(RECIPES[0]).all() as Record<string, number>[]
    for (const name of Object.keys(row)) expect(name).toMatch(SAFE_IDENTIFIER)
    // Snacks (3.00) and three Streamy charges (15.49) have no category
    expect(row.uncategorized).toBe(4)
    expect(row.spending).toBeCloseTo(49.47, 2)
  })

  it('never tells the model to divide by 1000; the scope views already did', () => {
    expect(PROMPT).not.toContain('/ 1000')
    expect(PROMPT).not.toContain('/1000')
  })
})

describe('system prompt currency guidance', () => {
  const MIXED_CTX: PromptDbContext = {
    ...CTX,
    accounts: [
      { name: 'Chase Checking', currency: 'USD' },
      { name: 'Amex 💳 Card', currency: 'EUR' }
    ]
  }

  it('stays silent when every account shares a currency', () => {
    expect(PROMPT).not.toContain('do NOT share a currency')
    // and costs those users no extra recipe to misread
    expect(sqlFragments(PROMPT)).toHaveLength(RECIPES.length)
  })

  it('adds exactly one runnable recipe when the accounts disagree', () => {
    const mixed = buildSystemPrompt(SCOPE, MIXED_CTX)
    expect(mixed).toContain('do NOT share a currency')
    const added = sqlFragments(mixed).filter((f) => !RECIPES.includes(f))
    expect(added).toHaveLength(1)

    const db = open()
    const grouped = db.prepare(added[0]).all() as Record<string, unknown>[]
    // the point of the recipe: USD and EUR never land in the same row
    expect(grouped.every((r) => r.currency === 'USD' || r.currency === 'EUR')).toBe(true)
    expect(new Set(grouped.map((r) => r.currency)).size).toBe(2)
    for (const name of Object.keys(grouped[0])) expect(name).toMatch(SAFE_IDENTIFIER)
  })
})

/**
 * The user's-data section is what lets the model filter by a real name instead
 * of guessing one, so it has to actually say what the context gives it.
 */
describe('system prompt user data content', () => {
  it('names the account and the date span', () => {
    expect(PROMPT).toContain('Chase Checking')
    expect(PROMPT).toContain('2026-01-01')
    expect(PROMPT).toContain('2026-07-31')
  })

  it('says there is no data for an empty scope', () => {
    const empty: PromptDbContext = { accounts: [], categories: [], dateRange: null }
    expect(buildSystemPrompt(SCOPE, empty)).toContain('no transaction data')
  })
})

/**
 * Fragments the prompt states inline in prose rather than as whole statements.
 * Each is asserted to appear in the prompt verbatim before being run, so the
 * test can't drift from the text it is checking. (Time grains need nothing
 * here anymore: month/quarter/year/week are real view columns, pinned by
 * scope-views.test.ts.)
 */
describe('system prompt month span', () => {
  const today = new Date(2026, 8, 24) // Sep 24, 2026

  it('starts the complete months after a mid-month first transaction and stops before today', () => {
    const lines = monthSpanLines(today, { min: '2025-09-14', max: '2026-09-22' })
    expect(lines[0]).toContain('Complete months run 2025-10 through 2026-08 (11 months)')
    expect(lines[1]).toContain('2026-09 is the month in progress: day 24 of 30')
  })

  it('counts a first month that starts on the 1st as complete', () => {
    expect(monthSpanLines(today, { min: '2026-06-01', max: '2026-09-02' })[0]).toContain(
      '2026-06 through 2026-08 (3 months)'
    )
  })

  it('says nothing about a month in progress when the data stopped before it', () => {
    const lines = monthSpanLines(today, { min: '2026-01-01', max: '2026-07-31' })
    expect(lines).toEqual([
      'Complete months run 2026-01 through 2026-07 (7 months); use these for averages and "typical" figures.'
    ])
  })

  it('claims no complete month when the data is younger than one', () => {
    const lines = monthSpanLines(today, { min: '2026-09-03', max: '2026-09-20' })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('month in progress')
  })
})
