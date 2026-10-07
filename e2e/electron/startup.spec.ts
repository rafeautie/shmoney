import { execFileSync, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, seed, test, type Desktop } from './fixtures'

const DAY = 24 * 60 * 60 * 1000

function withDb<T>(desktop: Desktop, run: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(join(desktop.dataDir, 'shmoney.db'))
  try {
    return run(db)
  } finally {
    db.close()
  }
}

const count = (db: DatabaseSync, sql: string): number => (db.prepare(sql).get() as { n: number }).n

test.describe('startup maintenance', () => {
  test('purges soft-deleted rows and stale undone entries, and settles abandoned replies', async ({
    desktop
  }) => {
    const first = await desktop.launch()
    await seed(first.window, 'starter')
    await desktop.closeAll()

    const now = Date.now()
    withDb(desktop, (db) => {
      const goal = db.prepare(
        `INSERT INTO savings_goals (name, mode, target_amount, started_at, currency, created_at, updated_at, deleted_at)
         VALUES (?, 'balance', 1000000, 0, 'USD', ?, ?, ?)`
      )
      goal.run('Live goal', now, now, null)
      goal.run('Deleted goal', now, now, 1_700_000_000)

      const filter = db.prepare(
        `INSERT INTO saved_filters (name, filters, created_at, updated_at, deleted_at) VALUES (?, '{}', 1, 1, ?)`
      )
      filter.run('Live filter', null)
      filter.run('Deleted filter', 1_700_000_000)

      const conversation = db.prepare(
        `INSERT INTO conversations (title, created_at, updated_at, model_label, deleted_at) VALUES (?, ?, ?, 'test', ?)`
      )
      const live = Number(conversation.run('Live chat', now, now, null).lastInsertRowid)
      const dead = Number(conversation.run('Deleted chat', now, now, now).lastInsertRowid)
      const message = db.prepare(
        `INSERT INTO chat_messages (conversation_id, role, parts, status, created_at) VALUES (?, ?, ?, ?, ?)`
      )
      message.run(live, 'user', '[{"type":"text","text":"hi"}]', 'complete', now)
      message.run(live, 'assistant', '[{"type":"text","text":"par"}]', 'streaming', now)
      message.run(dead, 'user', '[{"type":"text","text":"bye"}]', 'complete', now)

      const run = db.prepare(
        `INSERT INTO action_runs (created_at, trigger, label) VALUES (?, 'sync', ?)`
      )
      const staleRun = Number(run.run(now - 40 * DAY, 'Stale run').lastInsertRowid)
      const recentRun = Number(run.run(now - 2 * DAY, 'Recent run').lastInsertRowid)
      const entry = db.prepare(
        `INSERT INTO action_log (created_at, source, label, changes, undone_at, run_id, search_text)
         VALUES (?, 'user', ?, '[]', ?, ?, '')`
      )
      entry.run(now - 40 * DAY, 'Undone 31 days ago', now - 31 * DAY, staleRun)
      entry.run(now - 2 * DAY, 'Undone 1 day ago', now - 1 * DAY, recentRun)
      entry.run(now - 60 * DAY, 'Applied and old', null, null)
    })

    const second = await desktop.launch()
    await expect(second.window.getByRole('row', { name: /Checking/ })).toBeVisible()
    await desktop.closeAll()

    withDb(desktop, (db) => {
      const names = (sql: string): string[] =>
        (db.prepare(sql).all() as { name: string }[]).map((row) => row.name)
      expect(names('SELECT name FROM savings_goals ORDER BY name')).toEqual(['Live goal'])
      expect(names('SELECT name FROM saved_filters ORDER BY name')).toEqual(['Live filter'])
      expect(names('SELECT title AS name FROM conversations ORDER BY title')).toEqual(['Live chat'])
      // the deleted conversation's messages went with it
      expect(count(db, 'SELECT count(*) AS n FROM chat_messages')).toBe(2)

      const status = db
        .prepare(`SELECT status FROM chat_messages WHERE role = 'assistant'`)
        .get() as { status: string }
      expect(status.status).toBe('interrupted')
      expect(count(db, `SELECT count(*) AS n FROM chat_messages WHERE status = 'streaming'`)).toBe(
        0
      )

      expect(
        names(
          `SELECT label AS name FROM action_log WHERE label LIKE 'Undone%' OR label LIKE 'Applied%' ORDER BY label`
        )
      ).toEqual(['Applied and old', 'Undone 1 day ago'])
      // the purged entry's run went with it; the surviving one's stays
      expect(names(`SELECT label AS name FROM action_runs WHERE label LIKE '%run'`)).toEqual([
        'Recent run'
      ])
    })
  })
})

interface JournalEntry {
  tag: string
  when: number
}

const journal = (
  JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as { entries: JournalEntry[] }
).entries
const migrationSql = (entry: JournalEntry): string =>
  readFileSync(`drizzle/${entry.tag}.sql`).toString()

// 0024-0027 rewrite balances and add opening-balance transactions, so cutting
// just before them makes the upgrade exercise those data migrations
const CUT = journal.findIndex((entry) => entry.tag.startsWith('0024_'))

// builds the file the way an older release left it: schema through the cut, each
// migration recorded the way drizzle's migrator does (hash of the file text,
// created_at = the journal's `when`; only created_at decides what runs next)
function writeOldDatabase(path: string): { posted: number } {
  const db = new DatabaseSync(path)
  try {
    db.exec('PRAGMA foreign_keys = OFF')
    db.exec(
      'CREATE TABLE "__drizzle_migrations" (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric)'
    )
    const record = db.prepare('INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)')
    for (const entry of journal.slice(0, CUT)) {
      const text = migrationSql(entry)
      for (const statement of text.split('--> statement-breakpoint')) db.exec(statement)
      record.run(createHash('sha256').update(text).digest('hex'), entry.when)
    }

    const dining = db.prepare(`SELECT id FROM categories WHERE name LIKE '%Dining Out'`).get() as {
      id: number
    }
    const balanceDate = Math.floor(Date.now() / 1000) - 10 * 86400
    const account = db.prepare(
      `INSERT INTO accounts (name, currency, balance, balance_date, invert_balance) VALUES (?, 'USD', ?, ?, ?)`
    )
    // a manual account with a current balance typed at import time
    const checking = Number(account.run('Legacy Checking', 500_000, balanceDate, 0).lastInsertRowid)
    // stored in the institution's sign convention, flipped at read time
    account.run('Legacy Card', -20_000, balanceDate, 1)

    const tx = db.prepare(
      `INSERT INTO transactions (account_id, simplefin_id, posted, amount, description, category_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    tx.run(checking, 'import:1', balanceDate - 30 * 86400, -42_000, 'LEGACY BISTRO', dining.id)
    tx.run(checking, 'import:2', balanceDate - 20 * 86400, -8_000, 'LEGACY CAFE', dining.id)
    tx.run(checking, 'import:3', balanceDate - 15 * 86400, 100_000, 'LEGACY PAYROLL', null)

    // returning user: no onboarding dialog in the way
    db.prepare(`INSERT INTO settings (key, value) VALUES ('onboardingComplete', 'true')`).run()
    return { posted: balanceDate }
  } finally {
    db.close()
  }
}

test.describe('upgrading an old database', () => {
  test('migrates to the latest schema and keeps accounts, transactions and categories', async ({
    desktop
  }) => {
    expect(CUT).toBeGreaterThan(0)
    mkdirSync(desktop.dataDir, { recursive: true })
    writeOldDatabase(join(desktop.dataDir, 'shmoney.db'))

    const { window: page } = await desktop.launch()
    const dining = await page.evaluate(
      async () =>
        (await window.api.categories.list()).groups
          .flatMap((group) => group.categories)
          .find((category) => category.name.endsWith('Dining Out'))?.name
    )
    expect(dining).toBeDefined()

    // balances survive the data migrations unchanged: the typed balance is now
    // an opening-balance transaction, the inverted one was negated
    const checking = page.getByRole('row', { name: /Legacy Checking/ })
    await expect(checking).toContainText('$500.00')
    await expect(page.getByRole('row', { name: /Legacy Card/ })).toContainText('$20.00')

    await page.evaluate(() => {
      window.location.hash = '#/accounts?tab=transactions'
    })
    const bistro = page.getByRole('row', { name: /LEGACY BISTRO/ })
    await expect(bistro).toContainText('-$42.00')
    await expect(bistro).toContainText(dining!)
    await expect(page.getByRole('row', { name: /LEGACY CAFE/ })).toContainText(dining!)
    await expect(page.getByRole('row', { name: /LEGACY PAYROLL/ })).toContainText('$100.00')
    await expect(page.getByRole('row', { name: /Starting balance/ }).first()).toBeVisible()
    await desktop.closeAll()

    withDb(desktop, (db) => {
      const recorded = db
        .prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY id')
        .all() as { hash: string; created_at: number }[]
      expect(recorded.map((row) => Number(row.created_at))).toEqual(journal.map((e) => e.when))
      // the ones the app ran carry the hash drizzle computes from the file text
      for (const [index, entry] of journal.slice(CUT).entries()) {
        expect(recorded[CUT + index].hash).toBe(
          createHash('sha256').update(migrationSql(entry)).digest('hex')
        )
      }

      const columns = (table: string): string[] =>
        (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)
      expect(columns('accounts')).not.toContain('invert_balance')
      expect(columns('saved_filters')).toContain('deleted_at')
      expect(columns('connections')).not.toContain('deleted_account_ids')
      for (const table of ['savings_goals', 'llm_usage', 'action_runs', 'deleted_sync_accounts']) {
        expect(columns(table).length).toBeGreaterThan(0)
      }

      expect(
        count(db, `SELECT count(*) AS n FROM transactions WHERE description LIKE 'LEGACY%'`)
      ).toBe(3)
      expect(
        count(
          db,
          `SELECT count(*) AS n FROM transactions t JOIN categories c ON c.id = t.category_id
           WHERE t.description LIKE 'LEGACY%' AND c.name LIKE '%Dining Out'`
        )
      ).toBe(2)
    })
  })
})

// What a crash or power cut leaves: the main process dies without running any
// shutdown code. On Windows the killed process's children are orphaned rather
// than reaped, and they keep the single-instance lock, so a relaunch would exit
// at once; they are collected first and killed with it (only this app's own).
async function killTree(app: ChildProcess): Promise<void> {
  const children =
    process.platform === 'win32'
      ? execFileSync(
          'powershell',
          [
            '-NoProfile',
            '-Command',
            `(Get-CimInstance Win32_Process -Filter 'ParentProcessId=${app.pid}').ProcessId`
          ],
          { encoding: 'utf8' }
        )
          .split(/\s+/)
          .filter(Boolean)
          .map(Number)
      : []
  app.kill()
  for (const pid of children) {
    try {
      process.kill(pid)
    } catch {
      // already gone
    }
  }
  await expect.poll(() => app.exitCode !== null || app.signalCode !== null).toBe(true)
}

test.describe('durability', () => {
  test('the database is in WAL mode and a write survives the app being killed', async ({
    desktop
  }) => {
    const first = await desktop.launch()
    await seed(first.window, 'starter')
    const db = join(desktop.dataDir, 'shmoney.db')
    expect(withDb(desktop, (conn) => conn.prepare('PRAGMA journal_mode').get())).toMatchObject({
      journal_mode: 'wal'
    })

    const written = await first.window.evaluate(async () => {
      const rows = (
        await window.api.transactions.list({
          page: 0,
          pageSize: 20,
          sortBy: 'date',
          sortDir: 'desc'
        })
      ).rows.filter((row) => !row.pending && !row.isTransfer)
      const categories = (await window.api.categories.list()).groups.flatMap((g) => g.categories)
      const tx = rows[0]
      const categoryId = categories.find((c) => c.id !== tx.categoryId)!.id
      await window.api.transactions.setCategories({
        changes: [{ transactionId: tx.id, categoryId }]
      })
      await window.api.settings.set('theme', 'light')
      return { id: tx.id, categoryId }
    })

    await killTree(first.app.process())
    // the committed pages are still in the write-ahead log, not yet in the main file
    expect(existsSync(`${db}-wal`) && statSync(`${db}-wal`).size > 0).toBe(true)

    const { window: page } = await desktop.launch()
    const after = await page.evaluate(async (id) => {
      const tx = (
        await window.api.transactions.list({
          page: 0,
          pageSize: 100,
          sortBy: 'date',
          sortDir: 'desc'
        })
      ).rows.find((row) => row.id === id)
      return { categoryId: tx?.categoryId, theme: (await window.api.settings.getAll()).theme }
    }, written.id)
    expect(after).toEqual({ categoryId: written.categoryId, theme: 'light' })
    const entries = await page.evaluate(async () => (await window.api.actionLog.page()).entries)
    expect(entries.some((entry) => entry.label.startsWith('Set category'))).toBe(true)
  })
})
