import type { DatabaseSync } from 'node:sqlite'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { scopeViewsDdl } from '../sql-tool'
import { migratedDb } from '../test-db'
import type { PromptDbContext } from './chat'

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
  dateRange: { min: '2026-01', max: '2026-07' }
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
    INSERT INTO accounts (id, name, currency, balance, available_balance, balance_date, invert_balance)
    VALUES (1, 'Chase Checking', 'USD', 1234560, 1000000, 0, 0),
           (2, 'Amex 💳 Card', 'EUR', 250000, NULL, 0, 0);
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
           (10, 1, 't10', ${day(7, 31)}, -7000, 'Last day', 0, ${day(7, 31)}, ${GROCERIES});
  `)
}

function open(): DatabaseSync {
  const db = migratedDb()
  seed(db)
  for (const ddl of scopeViewsDdl({ accountId: null })) db.exec(ddl)
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
    expect(RECIPES).toHaveLength(12)
  })

  // the merchant recipe answers "where / which store do I spend" by grouping on
  // the raw description — the column the app has no cleaner substitute for — so
  // the user never has to say "group by description". It filters to spending and
  // comes back one row per description.
  it('groups spending by raw description, so "which store" needs no merchant column', () => {
    const recipe = RECIPES.find((r) => r.includes('GROUP BY description'))
    expect(recipe).toBeDefined()
    expect(recipe).toContain('WHERE amount < 0')
    const rows = db.prepare(recipe as string).all() as Record<string, unknown>[]
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => 'description' in r && typeof r.spending === 'number')).toBe(true)
    // one row per description: the group key never repeats
    const labels = rows.map((r) => r.description)
    expect(new Set(labels).size).toBe(labels.length)
  })

  // the income-vs-spending recipe: the two sides of a measure comparison are
  // columns of ONE query (each charts as its own series), never two queries
  it('keeps income and spending as columns of one query, so each draws its own line', () => {
    const recipe = RECIPES.find((r) => r.includes('AS income') && r.includes('AS spending'))
    expect(recipe).toBeDefined()
    const rows = db.prepare(recipe as string).all() as Record<string, unknown>[]
    // seeded months: May (spend only), June (spend + paycheck), July (spend only)
    expect(rows).toHaveLength(3)
    const june = rows.find((r) => r.month === '2026-06')
    expect(june).toMatchObject({ income: 500, spending: 20.34, net: 479.66 })
  })

  it('tx drops transfers, pending and undated rows', () => {
    const rows = db.prepare('SELECT * FROM tx').all()
    // rows 1-6 and 10 survive; 7 is a transfer, 8 is pending, 9 has no date
    expect(rows).toHaveLength(7)
    expect(rows.map((r) => (r as { description: string }).description)).not.toContain(
      'Moved to savings'
    )
  })

  // REGRESSION: the model abbreviated the old pasted base CTE, lost its
  // `c.name AS category` alias, and wrote `t.category` — a hard error against
  // a view without that column. tx is a real view now, but the model can still
  // write its own CTE; every label it reaches for must stay a real column.
  it('a hand-written CTE reaching for t.category still runs', () => {
    expect(() =>
      db
        .prepare(
          `WITH tx AS (SELECT t.amount, t.category, t.txn_date FROM transactions t
             WHERE t.txn_date IS NOT NULL AND t.pending = 0)
           SELECT strftime('%Y-%m', txn_date) AS month, category, ROUND(SUM(-amount), 2) AS spending
           FROM tx WHERE amount < 0 GROUP BY month, category ORDER BY month, spending DESC`
        )
        .all()
    ).not.toThrow()
  })

  it.each(RECIPES.map((sql, i) => [i, sql] as const))('recipe %i executes', (_i, recipe) => {
    expect(() => db.prepare(recipe).all()).not.toThrow()
  })

  it.each(RECIPES.map((sql, i) => [i, sql] as const))(
    'recipe %i returns rows, so the shape is exercised, not just parsed',
    (_i, recipe) => {
      expect((db.prepare(recipe).all() as unknown[]).length).toBeGreaterThan(0)
    }
  )

  // the shipped bug, generalized: every recipe must MODEL a safe alias, since
  // the model infers its naming rule from these columns
  it.each(RECIPES.map((sql, i) => [i, sql] as const))(
    'recipe %i names every column as a bare identifier',
    (_i, recipe) => {
      const [row] = db.prepare(recipe).all() as Record<string, unknown>[]
      for (const name of Object.keys(row)) expect(name).toMatch(SAFE_IDENTIFIER)
    }
  )

  // REGRESSION: the prompt teaches by transcript, and an early draft printed
  // the chart call as a line of that transcript — `chart {"type": "bar", …}`
  // alone on a line, exactly where model output goes. The model wrote it into
  // its answer as text and drew no chart. A tool call is made, never written,
  // so the prompt may not contain a line a model could emit verbatim as one.
  // The JSON specs stay legal where they read as reference ("- trend: {…}").
  // Two shapes qualify, both from that draft: a tool name heading a line that
  // also carries a JSON payload, and a tool name alone on a line as a label
  // over the SQL below it. Prose that merely opens with the word ("Chart with x
  // day, group month…") is not a line the model can emit as a call, and stays
  // legal.
  it('never shows a tool call as an emittable line', () => {
    const emittable = PROMPT.split('\n').map((line) => line.trim())
    expect(
      emittable.filter(
        (line) => /^(chart|query)\b.*\{/i.test(line) || /^(chart|query)$/i.test(line)
      )
    ).toEqual([])
  })

  it('never tells the model to divide by 1000; the scope views already did', () => {
    expect(PROMPT).not.toContain('/ 1000')
    expect(PROMPT).not.toContain('/1000')
  })

  // REGRESSION: a bare `OVER (ORDER BY month)` uses the default RANGE frame,
  // which gives every row sharing the ORDER BY value the whole group's total.
  // Harmless in the recipe as written (month is unique there) but silently
  // wrong the moment the model adapts it to a query grouped by month AND
  // something else, which the recipe right above it does.
  it('spells out a ROWS frame on every window function, so adapting one stays correct', () => {
    const windows = PROMPT.match(/OVER \([^)]*\)/g) ?? []
    expect(windows.length).toBeGreaterThan(0)
    for (const clause of windows) expect(clause).toContain('ROWS BETWEEN')
  })

  it('does not let an income-only category be reported as having spent 0.00', () => {
    // the breakdown recipes filter the rows before summing, rather than relying
    // on CASE alone, so a category that only ever took money in is absent
    // instead of ranking at 0.00
    const breakdown = RECIPES.find((r) => r.includes('GROUP BY category ORDER BY'))
    expect(breakdown).toContain('WHERE amount < 0')
  })
})

/**
 * Traps that produce a wrong NUMBER rather than an error, verified by running
 * the wrong form beside the right one. These are the expensive failures: the
 * model states the figure as fact and the user has no way to see it is off.
 */
describe('system prompt silent-wrong-answer guards', () => {
  let db: DatabaseSync
  beforeAll(() => {
    db = open()
  })

  const rows = (sql: string): Record<string, unknown>[] =>
    db.prepare(sql).all() as Record<string, unknown>[]

  // A month with no transactions produces no row, so every "average per month"
  // form the model reaches for natively (AVG over the monthly totals, or
  // SUM/COUNT(*)) divides by the months that HAVE data. The seeded window is
  // the real shape of this: six calendar months, three of them empty, so the
  // native form overstates the average by 2x and states it as fact.
  it('averages per month over a literal calendar divisor, not over the rows returned', () => {
    const window = "month BETWEEN '2026-02' AND '2026-07'" // 6 months; only 05, 06, 07 have data
    const spend = 'SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END)'
    const prescribed = rows(
      `SELECT ROUND(${spend} / 6.0, 2) AS avg_monthly_spending FROM tx WHERE ${window}`
    )
    const overRowsReturned = rows(
      `WITH m AS (SELECT month, ${spend} AS total FROM tx WHERE ${window} GROUP BY month)
       SELECT ROUND(AVG(total), 2) AS avg_monthly_spending FROM m`
    )

    expect(rows(`SELECT DISTINCT month FROM tx WHERE ${window}`)).toHaveLength(3)
    // same numerator, denominator 6 vs 3: the divisor is the whole difference
    expect(prescribed[0].avg_monthly_spending).toBeCloseTo(
      (overRowsReturned[0].avg_monthly_spending as number) / 2,
      2
    )
    // and the recipe that ships is the prescribed form, divisor written as a
    // decimal so SQLite doesn't truncate the quotient to a whole number
    const recipe = RECIPES.find((r) => r.includes('avg_monthly_spending'))
    expect(recipe).toContain('/ 6.0')
    expect(rows(recipe as string)[0].avg_monthly_spending).not.toEqual(
      Math.trunc(rows(recipe as string)[0].avg_monthly_spending as number)
    )
  })

  // REGRESSION: asked to compare June with July, the model charted the day
  // rows correctly and then reported "$1,633.64 in July", which was June DAY
  // ONE's spending read off the nearest row. Prose telling it not to do that
  // did not stop it, so the recipe now carries the month's own total on every
  // row: the right number sits in the column beside the one it grabs.
  it('carries each month total on every day row of the comparison recipe', () => {
    const recipe = RECIPES.find((r) => r.includes('month_total'))
    expect(recipe).toBeDefined()
    const rows = db.prepare(recipe as string).all() as Record<string, unknown>[]
    expect(rows.length).toBeGreaterThan(0)

    // month_total is constant within a month, and equals that month's sum of
    // the day values: the figure the reply should quote
    const byMonth = new Map<string, { total: Set<unknown>; summed: number }>()
    for (const row of rows) {
      const month = String(row.month)
      const seen = byMonth.get(month) ?? { total: new Set(), summed: 0 }
      seen.total.add(row.month_total)
      seen.summed += Number(row.spending)
      byMonth.set(month, seen)
    }
    expect(byMonth.size).toBeGreaterThan(1)
    for (const [, { total, summed }] of byMonth) {
      expect(total.size).toBe(1)
      expect(Number([...total][0])).toBeCloseTo(summed, 2)
    }
    // and a day's own figure must not be mistakable for the month's
    expect(rows.some((r) => Number(r.spending) !== Number(r.month_total))).toBe(true)
  })

  // REGRESSION: two of eight smoke questions failed outright because the model
  // wrote `WHERE name = 'Premier Savings'` against 'Premier Savings (9809)'.
  // The prose rule existed and was ignored; this is the same rule as a recipe.
  it('matches an account by LIKE on the distinctive word, not = on the name', () => {
    const recipe = RECIPES.find((r) => r.includes('FROM accounts'))
    expect(recipe).toBeDefined()
    expect(recipe).toContain('LIKE')
    expect(recipe).not.toMatch(/name\s*=/)
    // the seeded account is 'Chase Checking', so a bare = on a remembered word
    // finds nothing while the recipe's LIKE finds it: the actual failure mode
    expect(db.prepare(recipe as string).all()).toHaveLength(1)
    expect(db.prepare(`SELECT name FROM accounts WHERE name = 'Checking'`).all()).toHaveLength(0)
  })

  it('warns that a full-date upper endpoint drops the last day of a timed column', () => {
    // txn_date is a bare date, but posted/transacted_at carry a time, so
    // '2026-07-31' as an upper bound sorts before '2026-07-31 12:00:00'
    const range = "BETWEEN '2026-07-01' AND '2026-07-31'"
    const onTxnDate = rows(
      `SELECT description FROM tx WHERE txn_date ${range} ORDER BY txn_date`
    ).map((r) => r.description)
    const onPosted = rows(
      `SELECT description FROM transactions WHERE posted ${range} ORDER BY posted`
    ).map((r) => r.description)
    const guarded = rows(
      `SELECT description FROM transactions WHERE date(posted) ${range} ORDER BY posted`
    ).map((r) => r.description)

    expect(onTxnDate).toContain('Last day') // bare date column: fine
    expect(onPosted).not.toContain('Last day') // same range, timed column: gone
    expect(guarded).toContain('Last day') // the form the prompt prescribes
    expect(PROMPT).toContain('drops that whole last day')
  })

  it('warns that NOT LIKE on category silently drops uncategorized rows', () => {
    const dining = rows(`SELECT COUNT(*) AS n FROM tx WHERE category LIKE '%Dining%'`)
    const notDining = rows(`SELECT COUNT(*) AS n FROM tx WHERE category NOT LIKE '%Dining%'`)
    const guarded = rows(
      `SELECT COUNT(*) AS n FROM tx WHERE (category NOT LIKE '%Dining%' OR category IS NULL)`
    )
    const total = rows(`SELECT COUNT(*) AS n FROM tx`)[0].n as number
    // the two halves of a NOT LIKE split do not add up; the guarded form does
    expect((dining[0].n as number) + (notDining[0].n as number)).toBeLessThan(total)
    expect((dining[0].n as number) + (guarded[0].n as number)).toBe(total)
    expect(PROMPT).toContain('OR category IS NULL')
  })

  it('warns that avg_3mo counts rows, not calendar months, when a month has no data', () => {
    // the seeded data has no April, so a 3-row window over Mar/May/Jun is not
    // a 3-calendar-month window; the prompt has to say so, because SQL cannot
    const months = rows(`SELECT month FROM tx GROUP BY month ORDER BY month`).map((r) => r.month)
    expect(months).toEqual(['2026-05', '2026-06', '2026-07']) // no gap-free guarantee
    expect(PROMPT).toContain('those are the three months that have data')
  })

  it('gives the model an account NAME to group by, so a chart axis is not 1, 2, 3', () => {
    // the view carries it: a name the model must join for is a name it will
    // not get
    expect(
      rows(
        `SELECT account_name, ROUND(SUM(-amount), 2) AS spending
         FROM tx WHERE amount < 0 GROUP BY account_name ORDER BY spending DESC`
      )
    ).toEqual([
      { account_name: 'Chase Checking', spending: 55.34 },
      { account_name: 'Amex 💳 Card', spending: 4.5 }
    ])
  })

  it('gives the model a category_id, so budgets can be joined without a name match', () => {
    // budgets key on category_id; without it on tx the obvious join is a hard
    // error and the only working alternative is joining on the name string
    expect(() =>
      rows(
        `SELECT b.month, ROUND(SUM(-tx.amount), 2) AS actual
         FROM tx JOIN budgets b ON b.category_id = tx.category_id
         WHERE tx.amount < 0 GROUP BY b.month`
      )
    ).not.toThrow()
  })
})

/**
 * The currency rule renders only for users whose accounts disagree about it.
 * Stated as a caution it was ignored, because every recipe the model actually
 * copies omits currency; it ships as a recipe, and only to the users it binds.
 */
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
  it('names the account, a category and the date span', () => {
    expect(PROMPT).toContain('Chase Checking')
    expect(PROMPT).toContain('🍽️ Dining Out')
    expect(PROMPT).toContain('2026-01')
    expect(PROMPT).toContain('2026-07')
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
describe('system prompt inline expressions', () => {
  let db: DatabaseSync
  beforeAll(() => {
    db = open()
  })

  // totals over every non-transfer, non-pending, dated row: 12.34 + 8 + 25 + 3
  // + 7 spent on the USD account, 4.50 on the EUR one, 500 in. They
  // deliberately blend currencies, which is what an unqualified measure does;
  // the prompt's separate rule is to GROUP BY currency, not to change these.
  it.each([
    ['spending', 'ROUND(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 2) AS spending', 59.84],
    ['income', 'ROUND(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 2) AS income', 500],
    ['net', 'ROUND(SUM(amount), 2) AS net', 440.16]
  ])('the %s measure is stated correctly and sums real amounts', (_name, expression, total) => {
    expect(PROMPT).toContain(expression)
    const [row] = db.prepare(`SELECT ${expression} FROM tx`).all() as Record<string, number>[]
    expect(Object.values(row)[0]).toBeCloseTo(total, 2)
  })
})
