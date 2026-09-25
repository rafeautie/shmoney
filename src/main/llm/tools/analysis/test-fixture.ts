// Test-only: one seeded household every typed-tool test reads, so the tools are
// checked against the same known figures. Built on migratedDb (real
// migrations, the migration-seeded categories) with the chat scope views and
// goal tables in place, exactly as the worker sets them up before a turn.
//
// "Today" is 2026-09-24. Data runs 2025-09-10 to 2026-09-20: 2025-09 is a
// partial first month, 2025-10 through 2026-08 are 11 complete months, and
// 2026-09 is the month in progress. Every amount is milliunits in the tables.
import type { DatabaseSync } from 'node:sqlite'
import { GOAL_STATUS_LABELS } from '@shared/goals'
import { migratedDb } from '../../test-db'
import { GOAL_HISTORY_INSERT_SQL, GOAL_INSERT_SQL, goalTableDdl, scopeViewsDdl } from '../sql-tool'
import type { AnalysisContext, GoalPaceInput } from './common'

export const TODAY = '2026-09-24'
export const DATA = { min: '2025-09-10', max: '2026-09-20' }

/** unix seconds at local noon, the app's import convention */
export function noon(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return Math.floor(new Date(y, m - 1, d, 12).getTime() / 1000)
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** 2025-09 through 2026-09 */
export const MONTHS: string[] = Array.from({ length: 13 }, (_, i) => {
  const date = new Date(2025, 8 + i, 1)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
})

interface SeedTx {
  account: number
  day: string
  amount: number
  description: string
  category: string | null
}

/** every seeded transaction, in major units, before insertion */
export function fixtureTransactions(): SeedTx[] {
  const rows: SeedTx[] = []
  const add = (
    account: number,
    day: string,
    amount: number,
    description: string,
    category: string | null
  ): void => {
    if (day < DATA.min || day > DATA.max) return
    rows.push({ account, day, amount, description, category })
  }
  MONTHS.forEach((month, i) => {
    const d = (n: number): string => `${month}-${pad(n)}`
    // income: two paychecks
    add(1, d(1), 2500, 'ACME CORP PAYROLL PPD', '💵 Income')
    add(1, d(15), 2500, 'ACME CORP PAYROLL PPD', '💵 Income')
    // bills
    add(1, d(1), -2000, 'ZELLE PAYMENT TO OAKWOOD PROPERTIES', '🏠 Housing')
    add(1, d(22), -(80 + (i % 4) * 10), 'PGANDE WEB ONLINE', '💡 Utilities')
    // subscriptions: Netflix goes up from 2026-05
    add(3, d(5), month >= '2026-05' ? -17.99 : -15.49, 'NETFLIX.COM', '📺 Subscriptions')
    add(3, d(12), -11.99, 'SPOTIFY USA', '📺 Subscriptions')
    // groceries weekly, creeping up
    for (const day of [3, 10, 17, 24])
      add(3, d(day), -(100 + i * 2), 'WHOLE FOODS MKT #10233', '🛒 Groceries')
    // dining: coffee weekly, tacos monthly
    for (const day of [2, 9, 16, 23]) add(3, d(day), -6.5, 'BLUE BOTTLE COFFEE', '🍽️ Dining Out')
    add(3, d(20), -24, 'SQ *TACOS EL GORDO', '🍽️ Dining Out')
    // shopping: one Amazon order a month
    add(3, d(8), -45, 'AMAZON.COM*RT4K21', '🛍️ Shopping')
    // savings transfer, excluded from analysis
    add(1, d(16), -500, 'ONLINE TRANSFER TO SAVINGS 4417', '🔄 Transfers')
    add(2, d(16), 500, 'ONLINE TRANSFER FROM CHECKING 0921', '🔄 Transfers')
  })
  // July's spike: a big Amazon order, the driver of July vs June
  add(3, '2026-07-18', -600, 'AMAZON.COM*RT4K21', '🛍️ Shopping')
  // September oddities for unusual: a duplicate charge and a new merchant
  add(3, '2026-09-18', -24, 'SQ *TACOS EL GORDO', '🍽️ Dining Out')
  add(3, '2026-09-12', -240, 'REI #45 BERKELEY', '🛍️ Shopping')
  // an uncategorized row
  add(3, '2026-08-14', -32, 'MYSTERY MERCHANT 991', null)
  return rows
}

export const GOALS: GoalPaceInput[] = [
  {
    id: 1,
    name: 'Trip to Japan',
    targetAmount: 6_000_000,
    baselineAmount: 0,
    progress: 2_500_000,
    startedAt: noon('2026-04-01'),
    targetDate: '2027-03-31',
    currency: 'USD'
  },
  {
    id: 2,
    name: 'Emergency fund',
    targetAmount: 30_000_000,
    baselineAmount: 20_000_000,
    progress: 26_000_000,
    startedAt: noon('2026-01-01'),
    targetDate: '2027-06-30',
    currency: 'USD'
  }
]

export function fixtureDb(): DatabaseSync {
  const db = migratedDb()
  db.exec(`
    INSERT INTO accounts (id, name, currency, balance, available_balance, balance_date)
    VALUES (1, 'Everyday Checking', 'USD', 4200000, NULL, 0),
           (2, 'High-Yield Savings', 'USD', 26000000, NULL, 0),
           (3, 'Rewards Visa', 'USD', -1350000, NULL, 0);
  `)
  const categoryId = new Map(
    (db.prepare('SELECT id, name FROM categories').all() as { id: number; name: string }[]).map(
      (r) => [r.name, r.id]
    )
  )
  const insert = db.prepare(
    `INSERT INTO transactions (account_id, simplefin_id, posted, amount, description, pending, transacted_at, category_id)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
  )
  fixtureTransactions().forEach((t, i) => {
    const at = noon(t.day)
    insert.run(
      t.account,
      `t${i}`,
      at,
      Math.round(t.amount * 1000),
      t.description,
      at,
      t.category === null ? null : (categoryId.get(t.category) ?? null)
    )
  })
  // budgets: groceries from January, dining from June (inherit forward)
  db.prepare('INSERT INTO budgets (category_id, month, amount) VALUES (?, ?, ?)').run(
    categoryId.get('🛒 Groceries')!,
    '2026-01',
    500_000
  )
  db.prepare('INSERT INTO budgets (category_id, month, amount) VALUES (?, ?, ?)').run(
    categoryId.get('🍽️ Dining Out')!,
    '2026-06',
    60_000
  )
  for (const ddl of scopeViewsDdl({ accountId: null })) db.exec(ddl)
  for (const ddl of goalTableDdl()) db.exec(ddl)
  // the goal tables as main/goals would fill them for these two goals
  db.prepare(GOAL_INSERT_SQL).run(
    1,
    'Trip to Japan',
    'contributions',
    'High-Yield Savings',
    'USD',
    6000,
    2500,
    3500,
    41.7,
    GOAL_STATUS_LABELS.behind,
    '2027-03-31',
    '2026-04-01 12:00:00',
    500,
    416.67,
    '2027-04-24'
  )
  db.prepare(GOAL_INSERT_SQL).run(
    2,
    'Emergency fund',
    'balance',
    'High-Yield Savings',
    'USD',
    30000,
    26000,
    4000,
    86.7,
    GOAL_STATUS_LABELS['on-track'],
    '2027-06-30',
    '2026-01-01 12:00:00',
    444.44,
    750,
    '2027-02-24'
  )
  const history = db.prepare(GOAL_HISTORY_INSERT_SQL)
  ;['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'].forEach((m, i) => {
    history.run(1, 'Trip to Japan', m, 500 * (i + 1) - (m === '2026-09' ? 500 : 0))
    history.run(2, 'Emergency fund', m, 22000 + 800 * (i + 1))
  })
  return db
}

/** a EUR card (account 4) with these charges, for the mixed-currency cases */
export function addEuroCard(
  db: DatabaseSync,
  charges: { day: string; amount: number; description: string; category: string | null }[]
): void {
  db.exec(
    "INSERT INTO main.accounts (id, name, currency, balance, available_balance, balance_date) VALUES (4, 'Euro Card', 'EUR', 0, NULL, 0)"
  )
  const insert = db.prepare(
    `INSERT INTO main.transactions (account_id, simplefin_id, posted, amount, description, pending, transacted_at, category_id)
     VALUES (4, ?, ?, ?, ?, 0, ?, (SELECT id FROM main.categories WHERE name = ?))`
  )
  charges.forEach((c, i) =>
    insert.run(
      `eur${i}`,
      noon(c.day),
      Math.round(c.amount * 1000),
      c.description,
      noon(c.day),
      c.category
    )
  )
}

/** the context a tool runs in against fixtureDb() */
export function fixtureContext(db: DatabaseSync = fixtureDb()): AnalysisContext {
  return {
    db: db as unknown as AnalysisContext['db'],
    today: TODAY,
    data: DATA,
    vocab: {
      categories: (
        db
          .prepare(
            'SELECT name FROM categories WHERE system_key IS NULL OR system_key = ? ORDER BY name'
          )
          .all('income') as { name: string }[]
      ).map((r) => r.name),
      accounts: ['Everyday Checking', 'High-Yield Savings', 'Rewards Visa'],
      goals: GOALS.map((g) => g.name)
    },
    goalPace: GOALS
  }
}
