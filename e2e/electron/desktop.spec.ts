import { existsSync, readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { expect, seed, test, type Desktop } from './fixtures'

type Launched = { app: ElectronApplication; window: Page }

// natives are stubbed on main's globalThis so a later app.evaluate can read
// what the code under test did
interface Recorded {
  __opened?: string[]
  __opened_paths?: string[]
  __notes?: { title: string; body: string }[]
  __navs?: { url: string; prevented: boolean }[]
}

const settingsDialog = (page: Page): Locator => page.getByRole('dialog', { name: 'Settings' })

async function openSettings(page: Page, section: string): Promise<Locator> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const dialog = settingsDialog(page)
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: section, exact: true }).click()
  return dialog
}

/** a returning user's profile that has no connection yet */
async function skipOnboarding(page: Page): Promise<void> {
  await page.evaluate(() => window.api.settings.set('onboardingComplete', true))
  await page.reload()
  await page.waitForFunction(() => !!document.querySelector('main'))
}

async function stubOpeners(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ shell }) => {
    const g = globalThis as unknown as Recorded
    g.__opened = []
    g.__opened_paths = []
    shell.openExternal = async (url: string) => {
      g.__opened?.push(url)
    }
    shell.openPath = async (path: string) => {
      g.__opened_paths?.push(path)
      return ''
    }
  })
}

const opened = (app: ElectronApplication): Promise<string[]> =>
  app.evaluate(() => (globalThis as unknown as Recorded).__opened ?? [])

const clipboardText = (app: ElectronApplication): Promise<string> =>
  app.evaluate(({ clipboard }) => clipboard.readText())

const mainLog = (desktop: Desktop): string => {
  const path = join(desktop.dataDir, 'logs', 'main.log')
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

function readDb<T>(desktop: Desktop, query: string): T[] {
  const db = new DatabaseSync(join(desktop.dataDir, 'shmoney.db'), { readOnly: true })
  try {
    return db.prepare(query).all() as T[]
  } finally {
    db.close()
  }
}

async function relaunch(desktop: Desktop): Promise<Launched> {
  await desktop.closeAll()
  return desktop.launch()
}

test.describe('updates', () => {
  test('an unpackaged build has updates disabled everywhere', async ({ desktop }) => {
    const { app, window: page } = await desktop.launch()
    await skipOnboarding(page)

    const state = await page.evaluate(() => window.api.updates.getState())
    expect(state).toEqual({
      status: 'disabled',
      version: null,
      progress: null,
      error: null,
      url: null
    })
    expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(false)
    // a check request is a no-op rather than an error
    expect(await page.evaluate(() => window.api.updates.check())).toMatchObject({
      status: 'disabled'
    })

    const dialog = await openSettings(page, 'About')
    await expect(
      dialog.getByText('Automatic updates are disabled in development builds.')
    ).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Check for updates' })).toBeDisabled()
  })
})

test.describe('diagnostics', () => {
  test('get() has the version, platform and recent log lines, with home paths scrubbed', async ({
    desktop
  }) => {
    const { app, window: page } = await desktop.launch()
    await skipOnboarding(page)

    const home = os.homedir()
    await page.evaluate(
      (detail) => {
        window.api.log.write({ level: 'warn', event: 'e2e.marker', detail })
      },
      `could not open ${home}\\Documents\\statement.qif and ${home.replaceAll('\\', '/')}/x`
    )

    const version = await app.evaluate(({ app }) => app.getVersion())
    await expect
      .poll(() => page.evaluate(() => window.api.diagnostics.get()))
      .toContain('e2e.marker')
    const text = await page.evaluate(() => window.api.diagnostics.get())

    expect(text).toContain(`shmoney ${version} (dev)`)
    expect(text).toContain(`${process.platform} `)
    expect(text).toContain('--- last 100 log lines ---')
    expect(text).toContain('app.start')

    const lower = text.toLowerCase()
    expect(lower).not.toContain(home.toLowerCase())
    expect(lower).not.toContain(home.replaceAll('\\', '/').toLowerCase())
    // the log view re-escapes backslashes, so match either slash style
    expect(text).toMatch(/~[\\/]+Documents[\\/]+statement\.qif/)
    expect(text).toContain('~/x')

    // the file itself is scrubbed at write time, not just the excerpt
    expect(mainLog(desktop).toLowerCase()).not.toContain(home.toLowerCase())
  })

  test('copy() puts exactly the previewed text on the clipboard', async ({ desktop }) => {
    const { app, window: page } = await desktop.launch()
    await skipOnboarding(page)

    const text = await page.evaluate(async () => {
      const diagnostics = await window.api.diagnostics.get()
      await window.api.diagnostics.copy(diagnostics)
      return diagnostics
    })
    expect(text.length).toBeGreaterThan(100)
    expect(await clipboardText(app)).toBe(text)
  })

  test('openLogsFolder opens the logs directory', async ({ desktop }) => {
    const { app, window: page } = await desktop.launch()
    await skipOnboarding(page)
    await stubOpeners(app)

    await page.evaluate(() => window.api.diagnostics.openLogsFolder())
    const paths = await app.evaluate(() => (globalThis as unknown as Recorded).__opened_paths)
    expect(paths).toHaveLength(1)
    expect(resolve(paths![0]).toLowerCase()).toBe(resolve(desktop.dataDir, 'logs').toLowerCase())
    expect(existsSync(paths![0])).toBe(true)
  })

  test('the Report bug page shows the same text it copies', async ({ desktop }) => {
    const { app, window: page } = await desktop.launch()
    await skipOnboarding(page)
    await stubOpeners(app)

    const dialog = await openSettings(page, 'About')
    await dialog.getByRole('button', { name: 'Report bug' }).click()
    const version = await app.evaluate(({ app }) => app.getVersion())
    const preview = dialog.locator('pre')
    await expect(preview).toContainText(`shmoney ${version} (dev)`)
    await expect(preview).toContainText('--- last 100 log lines ---')
    await expect(preview).toContainText('app.start')

    await dialog.getByRole('button', { name: 'Open logs folder' }).click()
    await expect
      .poll(() => app.evaluate(() => (globalThis as unknown as Recorded).__opened_paths?.length))
      .toBe(1)

    const shown = await preview.evaluate((el) => el.textContent ?? '')
    await dialog.getByRole('button', { name: 'Copy diagnostics and open GitHub' }).click()
    await expect.poll(() => clipboardText(app)).toBe(shown)
    // the follow-up GitHub link goes to the OS browser, not into the app
    await expect
      .poll(() => opened(app))
      .toEqual([expect.stringMatching(/^https:\/\/github\.com\/.+\/issues\/new/)])
  })

  test('an uncaught renderer error is logged and appears in diagnostics', async ({ desktop }) => {
    const { window: page } = await desktop.launch()
    await skipOnboarding(page)

    await page.evaluate(() =>
      setTimeout(() => {
        throw new Error('e2e boom')
      })
    )
    await expect.poll(() => mainLog(desktop)).toContain('e2e boom')
    expect(mainLog(desktop)).toContain('uncaught-error')

    const text = await page.evaluate(() => window.api.diagnostics.get())
    expect(text).toContain('uncaught-error')
    expect(text).toContain('e2e boom')
  })
})

test.describe('storage', () => {
  test('the size is the db plus wal plus shm on disk, with a per-table breakdown', async ({
    desktop
  }) => {
    const { window: page } = await desktop.launch()
    await seed(page, 'household')

    const dbFile = join(desktop.dataDir, 'shmoney.db')
    const onDisk = (): number =>
      ['', '-wal', '-shm'].reduce(
        (sum, suffix) => sum + (existsSync(dbFile + suffix) ? statSync(dbFile + suffix).size : 0),
        0
      )

    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.api.storage.getDatabaseSize())).totalBytes - onDisk()
      )
      .toBe(0)

    const size = await page.evaluate(() => window.api.storage.getDatabaseSize())
    const byName = new Map(size.tables.map((t) => [t.name, t.bytes]))
    expect(byName.get('transactions')).toBeGreaterThan(0)
    expect(byName.get('accounts')).toBeGreaterThan(0)
    expect(size.tables.reduce((sum, t) => sum + t.bytes, 0)).toBeLessThanOrEqual(size.totalBytes)
    // largest first
    expect(size.tables.map((t) => t.bytes)).toEqual(
      [...size.tables.map((t) => t.bytes)].sort((a, b) => b - a)
    )
  })

  test('Settings > Storage shows the Transactions segment', async ({ desktop }) => {
    const { window: page } = await desktop.launch()
    await seed(page, 'household')

    const dialog = await openSettings(page, 'Storage')
    await expect(dialog.getByRole('heading', { name: 'Storage', exact: true })).toBeVisible()
    await expect(dialog.getByText(/^Transactions\s*[\d.]+ [KM]B$/)).toBeVisible()
    await expect(dialog.getByText(/^Accounts\s*[\d.]+ [KM]B$/)).toBeVisible()
  })
})

test.describe('connection and keychain', () => {
  test('debug.rawAccounts rejects without a connection and returns accounts with one', async ({
    desktop
  }) => {
    const { window: page } = await desktop.launch()
    await skipOnboarding(page)

    const rejection = await page.evaluate(() =>
      window.api.debug.rawAccounts().then(
        () => 'resolved',
        (e: unknown) => (e instanceof Error ? e.message : String(e))
      )
    )
    expect(rejection).toContain('Not connected to SimpleFIN')

    await page.evaluate(() => window.api.connection.connect({ setupToken: 'demo:starter' }))
    const raw = await page.evaluate(() => window.api.debug.rawAccounts())
    expect(raw).toMatchObject({ accounts: expect.any(Array) })
    expect((raw as { accounts: unknown[] }).accounts.length).toBeGreaterThan(0)
  })

  test('the access URL rests encrypted and still decrypts after a restart', async ({ desktop }) => {
    const first = await desktop.launch()
    await skipOnboarding(first.window)

    const dialog = await openSettings(first.window, 'Connection')
    await dialog.getByLabel('Setup token').fill('demo:starter')
    await dialog.getByRole('button', { name: 'Connect', exact: true }).click()
    await expect(dialog.getByRole('button', { name: 'Sync', exact: true })).toBeVisible()
    await expect
      .poll(() =>
        first.window.evaluate(() => window.api.connection.get().then((c) => c?.lastSyncedAt))
      )
      .toBeTruthy()
    await desktop.closeAll()

    const rows = readDb<{ access_url_encrypted: string }>(
      desktop,
      'SELECT access_url_encrypted FROM connections'
    )
    expect(rows).toHaveLength(1)
    const stored = rows[0].access_url_encrypted
    expect(stored.length).toBeGreaterThan(20)
    for (const view of [stored, Buffer.from(stored, 'base64').toString('latin1')]) {
      expect(view).not.toContain('demo:starter')
      expect(view).not.toContain('starter')
    }

    const second = await desktop.launch()
    await openSettings(second.window, 'Connection').then(async (again) => {
      await again.getByRole('button', { name: 'Sync', exact: true }).click()
      await expect(again.getByRole('button', { name: 'Sync', exact: true })).toBeEnabled()
    })
    const connection = await second.window.evaluate(() => window.api.connection.get())
    expect(connection?.lastSyncFailedAt).toBeNull()
    expect(connection?.lastSyncFailure).toBeNull()
    await expect(second.window.getByText('Sync failed')).toBeHidden()
  })

  test('without OS encryption, connecting shows the error and stores nothing', async ({
    desktop
  }) => {
    const { app, window: page } = await desktop.launch()
    await skipOnboarding(page)
    await app.evaluate(({ safeStorage }) => {
      safeStorage.isEncryptionAvailable = () => false
    })

    const dialog = await openSettings(page, 'Connection')
    await dialog.getByLabel('Setup token').fill('demo:starter')
    await dialog.getByRole('button', { name: 'Connect', exact: true }).click()
    await expect(
      dialog.getByText('Credential encryption is not available on this system')
    ).toBeVisible()
    expect(await page.evaluate(() => window.api.connection.get())).toBeNull()
    await desktop.closeAll()

    expect(readDb(desktop, 'SELECT id FROM connections')).toHaveLength(0)
  })
})

test.describe('OS notifications', () => {
  async function stubNotifications(app: ElectronApplication): Promise<void> {
    await app.evaluate(({ Notification }) => {
      const g = globalThis as unknown as Recorded
      g.__notes = []
      Notification.prototype.show = function (this: { title: string; body: string }) {
        g.__notes?.push({ title: this.title, body: this.body })
      }
    })
  }
  const setFocused = (app: ElectronApplication, focused: boolean): Promise<void> =>
    app.evaluate(({ BrowserWindow }, value) => {
      BrowserWindow.getAllWindows()[0].isFocused = () => value
    }, focused)
  const notes = (app: ElectronApplication): Promise<{ title: string; body: string }[]> =>
    app.evaluate(() => (globalThis as unknown as Recorded).__notes ?? [])
  const notify = (page: Page, title: string): Promise<void> =>
    page.evaluate((t) => window.api.app.notify(t, `${t} body`), title)

  test('shown only while unfocused and enabled', async ({ desktop }) => {
    const { app, window: page } = await desktop.launch()
    await skipOnboarding(page)
    await stubNotifications(app)

    // IPC messages from one renderer are handled in order, so the final
    // unfocused+enabled sentinel arriving proves the earlier ones were dropped
    await setFocused(app, true)
    await notify(page, 'focused')

    await setFocused(app, false)
    await page.evaluate(() => window.api.settings.set('nativeNotifications', false))
    await notify(page, 'disabled')

    await page.evaluate(() => window.api.settings.set('nativeNotifications', true))
    await notify(page, 'shown')

    await expect.poll(() => notes(app)).toEqual([{ title: 'shown', body: 'shown body' }])
  })

  test('the Notifications toggle in Settings controls it', async ({ desktop }) => {
    const { app, window: page } = await desktop.launch()
    await skipOnboarding(page)
    await stubNotifications(app)
    await setFocused(app, false)

    const dialog = await openSettings(page, 'General')
    const toggle = dialog.getByRole('switch', { name: /system notifications/i })
    await expect(toggle).toBeChecked()
    await toggle.click()
    await expect(toggle).not.toBeChecked()
    await expect
      .poll(() =>
        page.evaluate(() => window.api.settings.getAll().then((s) => s.nativeNotifications))
      )
      .toBe(false)
    await notify(page, 'muted')

    await toggle.click()
    await expect(toggle).toBeChecked()
    await notify(page, 'audible')
    await expect.poll(() => notes(app)).toEqual([{ title: 'audible', body: 'audible body' }])
  })
})

test.describe('links and navigation', () => {
  test('only https links reach the OS browser, and no window is created', async ({ desktop }) => {
    const { app, window: page } = await desktop.launch()
    await skipOnboarding(page)
    await stubOpeners(app)

    await page.evaluate(() => {
      window.open('http://example.com/plain')
      window.open('file:///c:/windows/system32/calc.exe')
      window.open('mailto:someone@example.com')
      window.open('javascript:void(0)')
      window.open('https://example.com/ok')
    })
    await expect.poll(() => opened(app)).toEqual(['https://example.com/ok'])

    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
    expect(app.windows()).toHaveLength(1)
  })

  test('the main window cannot be navigated to an external page', async ({ desktop }) => {
    const { app, window: page } = await desktop.launch()
    await skipOnboarding(page)
    const before = page.url()

    await app.evaluate(({ BrowserWindow }) => {
      const g = globalThis as unknown as Recorded
      g.__navs = []
      // registered after the app's own guard, so defaultPrevented is its verdict
      BrowserWindow.getAllWindows()[0].webContents.on('will-navigate', (event, url) => {
        g.__navs?.push({ url, prevented: event.defaultPrevented })
      })
    })
    await page.evaluate(() => {
      window.location.href = 'https://example.com/elsewhere'
    })
    await expect
      .poll(() => app.evaluate(() => (globalThis as unknown as Recorded).__navs))
      .toEqual([{ url: 'https://example.com/elsewhere', prevented: true }])
    expect(page.url()).toBe(before)
    expect(await page.evaluate(() => window.location.href)).toBe(before)
  })
})

test.describe('theme', () => {
  const chrome = (app: ElectronApplication): Promise<{ background: string; source: string }> =>
    app.evaluate(({ BrowserWindow, nativeTheme }) => ({
      background: BrowserWindow.getAllWindows()[0].getBackgroundColor().toLowerCase(),
      source: nativeTheme.themeSource
    }))

  test('switching themes repaints the window background and nativeTheme', async ({ desktop }) => {
    const { app, window: page } = await desktop.launch()
    await skipOnboarding(page)
    // dark is the default theme
    await expect.poll(() => chrome(app)).toEqual({ background: '#0a0a0a', source: 'dark' })

    const dialog = await openSettings(page, 'General')
    const theme = dialog.getByRole('radiogroup', { name: 'Theme' })
    await theme.getByRole('radio', { name: 'Light' }).click()
    await expect.poll(() => chrome(app)).toEqual({ background: '#ffffff', source: 'light' })
    await expect(page.locator('html')).not.toHaveClass(/dark/)

    await theme.getByRole('radio', { name: 'Dark' }).click()
    await expect.poll(() => chrome(app)).toEqual({ background: '#0a0a0a', source: 'dark' })
    await expect(page.locator('html')).toHaveClass(/dark/)

    await theme.getByRole('radio', { name: 'Light' }).click()
    await expect.poll(() => chrome(app)).toEqual({ background: '#ffffff', source: 'light' })
    await expect(page.locator('html')).not.toHaveClass(/dark/)
  })

  test('the stored theme is applied to the window at launch', async ({ desktop }) => {
    const first = await desktop.launch()
    await skipOnboarding(first.window)
    await first.window.evaluate(() => window.api.settings.set('theme', 'dark'))
    await expect.poll(() => chrome(first.app)).toMatchObject({ source: 'dark' })

    const second = await relaunch(desktop)
    expect(await chrome(second.app)).toEqual({ background: '#0a0a0a', source: 'dark' })
  })
})
