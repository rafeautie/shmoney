import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { expect, seed, test, type Desktop } from './fixtures'

const electronPath = createRequire(import.meta.url)('electron') as string

interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

type Launched = { app: ElectronApplication; window: Page }

const getBounds = (app: ElectronApplication): Promise<Bounds> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds())

const getNormalBounds = (app: ElectronApplication): Promise<Bounds> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNormalBounds())

const isMaximized = (app: ElectronApplication): Promise<boolean> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())

type SavedState = { x?: number; y?: number; width: number; height: number; maximized: boolean }

const savedWindowState = (page: Page): Promise<SavedState | null> =>
  page.evaluate(async () => (await window.api.settings.getAll()).windowState)

// the app saves 400ms after the last resize/move; waiting for the saved value
// makes the restart independent of that debounce
async function settled(page: Page, expected: Partial<SavedState>): Promise<void> {
  await expect.poll(() => savedWindowState(page)).toMatchObject(expected)
}

function writeSetting(desktop: Desktop, key: string, value: unknown): void {
  const db = new DatabaseSync(join(desktop.dataDir, 'shmoney.db'))
  try {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
      key,
      JSON.stringify(value)
    )
  } finally {
    db.close()
  }
}

test.describe('window state', () => {
  test('a resized and moved window reopens at the same bounds', async ({ desktop }) => {
    const first = await desktop.launch()
    await first.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setBounds({ x: 140, y: 90, width: 1010, height: 690 })
    )
    const placed = await getBounds(first.app)
    await settled(first.window, { x: placed.x, y: placed.y, maximized: false })
    await desktop.closeAll()

    const second = await desktop.launch()
    expect(await getBounds(second.app)).toEqual(placed)
    expect(await isMaximized(second.app)).toBe(false)
  })

  test('a maximized window reopens maximized and unmaximizes to its old size', async ({
    desktop
  }) => {
    const first = await desktop.launch()
    await first.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setBounds({ x: 150, y: 100, width: 1000, height: 680 })
    )
    const normal = await getNormalBounds(first.app)
    await first.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize())
    await settled(first.window, { maximized: true })
    await desktop.closeAll()

    const second = await desktop.launch()
    await expect.poll(() => isMaximized(second.app)).toBe(true)
    expect(await getNormalBounds(second.app)).toEqual(normal)
  })

  test('a saved rect on no display opens on screen with its size kept', async ({ desktop }) => {
    const first = await desktop.launch()
    await seed(first.window, 'starter')
    await desktop.closeAll()
    writeSetting(desktop, 'windowState', {
      x: 40_000,
      y: 30_000,
      width: 1100,
      height: 700,
      maximized: false
    })

    const second = await desktop.launch()
    const bounds = await getBounds(second.app)
    // DPI scaling can round a dimension by a pixel
    expect(Math.abs(bounds.width - 1100)).toBeLessThanOrEqual(2)
    expect(Math.abs(bounds.height - 700)).toBeLessThanOrEqual(2)
    const area = await second.app.evaluate(
      ({ BrowserWindow, screen }) =>
        screen.getDisplayMatching(BrowserWindow.getAllWindows()[0].getBounds()).workArea
    )
    const overlapX =
      Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x)
    const overlapY =
      Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y)
    expect(overlapX).toBeGreaterThanOrEqual(200)
    expect(overlapY).toBeGreaterThanOrEqual(100)
  })
})

// a second launch of the same executable on the same profile
function secondInstance(desktop: Desktop, ...args: string[]): ChildProcess {
  const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RENDERER_URL: '' }
  delete env.ELECTRON_RUN_AS_NODE
  return spawn(electronPath, ['.', `--user-data-dir=${desktop.dir}`, ...args], {
    env,
    stdio: 'ignore',
    windowsHide: true
  })
}

function exited(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) resolve(child.exitCode)
    else child.once('exit', (code) => resolve(code))
  })
}

// kills a straggler so a failed assertion can't leave a window behind
async function expectExit(child: ChildProcess, ms = 15_000): Promise<void> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms)
  })
  const result = await Promise.race([exited(child), timeout])
  clearTimeout(timer)
  if (result === 'timeout') {
    child.kill()
    throw new Error(`second instance still running after ${ms}ms`)
  }
  expect(result).toBe(0)
}

test.describe('single instance', () => {
  test('a second launch on the same profile exits and leaves the first running', async ({
    desktop
  }) => {
    const first = await desktop.launch()
    await seed(first.window, 'starter')

    await expectExit(secondInstance(desktop))

    await expect(first.window.getByRole('row', { name: /Checking/ })).toBeVisible()
    expect(
      await first.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
    ).toBe(1)
  })
})

const OFX = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<TRNUID>1
<STMTRS>
<CURDEF>USD
<BANKACCTFROM>
<BANKID>123456789
<ACCTID>0001
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260901
<DTEND>20260930
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260904120000
<TRNAMT>-12.34
<FITID>FIT-1
<NAME>OFX COFFEE
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260907120000
<TRNAMT>250.00
<FITID>FIT-2
<NAME>OFX REFUND
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`

const QIF = `!Type:Bank
D9/4/2026
T-21.00
PQIF LUNCH
^
D9/8/2026
T1,000.00
PQIF PAYCHECK
^
`

const CSV = 'Date,Description,Amount\n2026-09-01,COFFEE SHOP,-4.50\n'

const importDialog = (page: Page): Locator =>
  page.getByRole('dialog', { name: 'Import transactions' })

test.describe('opening statement files from the OS', () => {
  let files: string
  let ofx: string
  let qif: string
  let csv: string
  let missing: string

  test.beforeAll(() => {
    files = mkdtempSync(join(tmpdir(), 'shmoney-e2e-files-'))
    ofx = join(files, 'export.ofx')
    qif = join(files, 'export.qif')
    csv = join(files, 'bank.csv')
    missing = join(files, 'gone.qif')
    writeFileSync(ofx, OFX)
    writeFileSync(qif, QIF)
    writeFileSync(csv, CSV)
  })

  test.afterAll(() => {
    rmSync(files, { recursive: true, force: true })
  })

  // a profile that has finished onboarding, so the file is the only dialog
  async function returningUser(desktop: Desktop, args: string[]): Promise<Launched> {
    const first = await desktop.launch()
    await seed(first.window, 'starter')
    await desktop.closeAll()
    return desktop.launch(args)
  }

  // src/main/index.ts:146 sends the file on did-finish-load, but the renderer
  // only subscribes (import-file-host.tsx useEffect) after main.tsx's top-level
  // await on settings.initial() and the first render, so the message is lost and
  // the dialog never opens. The same payload sent after mount opens it (see the
  // second-instance test below).
  test.fixme('TRIAGE: a statement path on a cold launch is dropped before the renderer listens', async () => {})

  test('a .csv path and a missing path are ignored on a cold launch', async ({ desktop }) => {
    const { window: page } = await returningUser(desktop, [csv, missing])
    await expect(page.getByRole('row', { name: /Checking/ })).toBeVisible()
    await expect(importDialog(page)).toBeHidden()
  })

  test('a second instance hands a .qif to the running app and exits', async ({ desktop }) => {
    const { window: page } = await returningUser(desktop, [])
    await expect(page.getByRole('row', { name: /Checking/ })).toBeVisible()
    await expect(importDialog(page)).toBeHidden()

    await expectExit(secondInstance(desktop, qif))

    const dialog = importDialog(page)
    await expect(dialog.getByText('Pick the account these transactions belong to.')).toBeVisible()
    await expect(dialog.getByText('export.qif · 2 transactions')).toBeVisible()
  })

  test('a second instance ignores a .csv and a missing path', async ({ desktop }) => {
    const { window: page } = await returningUser(desktop, [])
    await expect(page.getByRole('row', { name: /Checking/ })).toBeVisible()

    await expectExit(secondInstance(desktop, csv))
    await expectExit(secondInstance(desktop, missing))
    // a real statement afterwards proves the earlier launches were already
    // delivered and dropped, not still in flight
    await expectExit(secondInstance(desktop, ofx))

    const dialog = importDialog(page)
    await expect(dialog.getByText('export.ofx · 2 transactions')).toBeVisible()
    await expect(dialog.getByText('bank.csv')).toBeHidden()
  })
})

interface Tx {
  id: number
  categoryId: number | null
  categoryName: string | null
  description: string
}

test.describe('persistence', () => {
  async function candidates(page: Page): Promise<{ txs: Tx[]; categories: number[] }> {
    return page.evaluate(async () => {
      const result = await window.api.transactions.list({
        page: 0,
        pageSize: 60,
        sortBy: 'date',
        sortDir: 'desc'
      })
      const list = await window.api.categories.list()
      return {
        txs: result.rows
          .filter((row) => !row.pending && !row.isTransfer)
          .map((row) => ({
            id: row.id,
            categoryId: row.categoryId,
            categoryName: row.categoryName,
            description: row.description
          })),
        categories: list.groups.flatMap((group) => group.categories.map((c) => c.id))
      }
    })
  }

  const categoryOf = (page: Page, id: number): Promise<number | null> =>
    page.evaluate(async (txId) => {
      const result = await window.api.transactions.list({
        page: 0,
        pageSize: 100,
        sortBy: 'date',
        sortDir: 'desc'
      })
      return result.rows.find((row) => row.id === txId)?.categoryId ?? null
    }, id)

  test('categories, budget fills and settings survive a restart', async ({ desktop }) => {
    const first = await desktop.launch()
    await seed(first.window)
    const { txs, categories } = await candidates(first.window)
    const tx = txs[0]
    const target = categories.find((id) => id !== tx.categoryId)!
    const fillCategory = categories.find((id) => id !== target)!
    const month = '2026-09'

    await first.window.evaluate(
      async ({ txId, categoryId, fillCategory, month }) => {
        await window.api.transactions.setCategories({
          changes: [{ transactionId: txId, categoryId }]
        })
        await window.api.budgets.setFill({ categoryId: fillCategory, month, amount: 123_000 })
        await window.api.settings.set('theme', 'light')
        await window.api.settings.set('blurAmounts', true)
      },
      { txId: tx.id, categoryId: target, fillCategory, month }
    )
    await desktop.closeAll()

    const second = await desktop.launch()
    expect(await categoryOf(second.window, tx.id)).toBe(target)
    const envelope = await second.window.evaluate(
      async ({ month, fillCategory }) =>
        (await window.api.budgets.summary({ month })).envelopes.find(
          (e) => e.categoryId === fillCategory
        )?.fill,
      { month, fillCategory }
    )
    expect(envelope).toBe(123_000)
    const stored = await second.window.evaluate(() => window.api.settings.getAll())
    expect(stored).toMatchObject({ theme: 'light', blurAmounts: true })
    await expect(second.window.locator('html')).not.toHaveClass(/dark/)
    await expect(second.window.getByRole('dialog')).toBeHidden()
  })

  test('keyboard undo ignores earlier sessions, while Activity can still undo them', async ({
    desktop
  }) => {
    const first = await desktop.launch()
    await seed(first.window)
    const { txs, categories } = await candidates(first.window)
    const [old, fresh] = txs
    const oldTarget = categories.find((id) => id !== old.categoryId)!
    const freshTarget = categories.find((id) => id !== fresh.categoryId)!
    const oldCategory = old.categoryId
    const freshCategory = fresh.categoryId

    await first.window.evaluate(
      (input) => window.api.transactions.setCategories({ changes: [input] }),
      { transactionId: old.id, categoryId: oldTarget }
    )
    const [entry] = await first.window.evaluate(
      async () => (await window.api.actionLog.page()).entries
    )
    await desktop.closeAll()

    const { window: page } = await desktop.launch()
    expect(await categoryOf(page, old.id)).toBe(oldTarget)

    // nothing from this session yet, so this must not reach the older entry
    await page.keyboard.press('Control+z')
    await expect(page.locator('[data-sonner-toast]')).toBeHidden()

    await page.evaluate((input) => window.api.transactions.setCategories({ changes: [input] }), {
      transactionId: fresh.id,
      categoryId: freshTarget
    })
    await page.keyboard.press('Control+z')
    await expect(page.locator('[data-sonner-toast]')).toBeVisible()
    await expect.poll(() => categoryOf(page, fresh.id)).toBe(freshCategory)
    expect(await categoryOf(page, old.id)).toBe(oldTarget)

    await page.evaluate(() => {
      window.location.hash = '#/activity'
    })
    // both entries share a label; the one from this session is already undone
    const row = page
      .locator('xpath=//*[contains(@class, "group/entry")]')
      .filter({ hasText: entry.label })
      .filter({ has: page.getByRole('button', { name: 'Undo', exact: true }) })
    await row.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect.poll(() => categoryOf(page, old.id)).toBe(oldCategory)
  })
})
