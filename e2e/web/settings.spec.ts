import type { Locator, Page } from '@playwright/test'
import { expect, test, type App } from '../fixtures'

const settingsDialog = (page: Page): Locator => page.getByRole('dialog', { name: 'Settings' })

async function storedSetting(app: App, key: string): Promise<unknown> {
  const rows = await app.sql<{ value: string }>(`SELECT value FROM settings WHERE key = '${key}'`)
  return rows.length > 0 ? JSON.parse(rows[0].value) : undefined
}

test.describe('opening and navigating', () => {
  test('the sidebar Settings button opens General and the URL carries the section', async ({
    app
  }) => {
    const { page } = app
    await app.open()
    await expect(settingsDialog(page)).toBeHidden()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(settingsDialog(page)).toBeVisible()
    await expect(page).toHaveURL(/settings=general/)
    await expect(settingsDialog(page).getByRole('button', { name: 'General' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    await expect(settingsDialog(page).getByRole('heading', { name: 'Appearance' })).toBeVisible()
  })

  test('a ?settings= URL opens that section over the current page', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/budget?settings=rules' })
    await expect(
      settingsDialog(page).getByRole('heading', { name: 'Rules', exact: true })
    ).toBeVisible()
    await expect(settingsDialog(page).getByRole('button', { name: 'Rules' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    await page.keyboard.press('Escape')
    await expect(settingsDialog(page)).toBeHidden()
    await expect(page).toHaveURL(/#\/budget/)
    await expect(page).not.toHaveURL(/settings=/)
  })

  test('an unknown section leaves Settings closed', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/accounts?settings=nonsense' })
    await expect(page.getByRole('link', { name: 'Budget', exact: true })).toBeVisible()
    await expect(settingsDialog(page)).toBeHidden()
  })

  test('switching sections swaps the pane and updates the URL', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/accounts?settings=general' })
    const dialog = settingsDialog(page)
    await dialog.getByRole('button', { name: 'Categories' }).click()
    await expect(page).toHaveURL(/settings=categories/)
    await expect(dialog.getByRole('heading', { name: 'Categories', exact: true })).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Appearance' })).toBeHidden()
    await dialog.getByRole('button', { name: 'Storage' }).click()
    await expect(dialog.getByRole('heading', { name: 'Storage', exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Storage' })).toHaveAttribute(
      'aria-current',
      'page'
    )
  })

  test('Escape steps back from a sub-page, then closes', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/accounts?settings=about' })
    const dialog = settingsDialog(page)
    await dialog.getByRole('button', { name: 'View licenses' }).click()
    await expect(page).toHaveURL(/settingsPage=licenses/)
    await expect(dialog.getByRole('heading', { name: 'Licenses and credits' })).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(dialog.getByRole('heading', { name: 'Licenses and credits' })).toBeHidden()
    await expect(dialog.getByRole('button', { name: 'View licenses' })).toBeVisible()
    await expect(page).not.toHaveURL(/settingsPage=/)

    await page.keyboard.press('Escape')
    await expect(settingsDialog(page)).toBeHidden()
  })

  test('the breadcrumb Back button returns to the section', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/accounts?settings=about&settingsPage=licenses' })
    const dialog = settingsDialog(page)
    await dialog.getByRole('button', { name: 'Back to About' }).click()
    await expect(dialog.getByRole('button', { name: 'View licenses' })).toBeVisible()
  })
})

test.describe('General', () => {
  test('the theme control switches the dark class and persists the choice', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/accounts?settings=general', theme: 'light' })
    const html = page.locator('html')
    const theme = settingsDialog(page).getByRole('radiogroup', { name: 'Theme' })
    await expect(html).not.toHaveClass(/dark/)

    await theme.getByRole('radio', { name: 'Dark' }).click()
    await expect(html).toHaveClass(/dark/)
    await expect.poll(() => storedSetting(app, 'theme')).toBe('dark')

    await theme.getByRole('radio', { name: 'Light' }).click()
    await expect(html).not.toHaveClass(/dark/)
    await expect.poll(() => storedSetting(app, 'theme')).toBe('light')

    await theme.getByRole('radio', { name: 'System' }).click()
    await expect.poll(() => storedSetting(app, 'theme')).toBe('system')
  })

  test('System follows the emulated OS color scheme', async ({ app }) => {
    const { page } = app
    await page.emulateMedia({ colorScheme: 'dark' })
    await app.open({ route: '/accounts?settings=general', theme: 'light' })
    const html = page.locator('html')
    await expect(html).not.toHaveClass(/dark/)
    await settingsDialog(page).getByRole('radio', { name: 'System' }).click()
    await expect(html).toHaveClass(/dark/)
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(html).not.toHaveClass(/dark/)
  })

  test('Hide amounts masks figures on the page behind and persists', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/accounts?settings=general' })
    const hidden = page.locator('[data-private].private-hidden')
    await expect(hidden).toHaveCount(0)

    await settingsDialog(page).getByRole('switch', { name: 'Hide amounts' }).click()
    await expect.poll(() => storedSetting(app, 'blurAmounts')).toBe(true)
    await expect(hidden.first()).toBeAttached()

    await settingsDialog(page).getByRole('switch', { name: 'Hide amounts' }).click()
    await expect.poll(() => storedSetting(app, 'blurAmounts')).toBe(false)
    await expect(hidden).toHaveCount(0)
  })

  test('Notifications shows in the desktop app and toggles', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/accounts?settings=general' })
    await expect(settingsDialog(page).getByRole('heading', { name: 'Notifications' })).toBeVisible()
    const toggle = settingsDialog(page).getByRole('switch', {
      name: /Show system notifications/
    })
    await expect(toggle).toBeChecked()
    await toggle.click()
    await expect.poll(() => storedSetting(app, 'nativeNotifications')).toBe(false)
  })

  test('the web demo hides Notifications', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/accounts?settings=general', desktop: false })
    await expect(settingsDialog(page).getByRole('heading', { name: 'Privacy' })).toBeVisible()
    await expect(settingsDialog(page).getByRole('heading', { name: 'Notifications' })).toBeHidden()
  })
})

test.describe('Connection', () => {
  test('a connected household shows sync state and disconnects after a confirm', async ({
    app
  }) => {
    const { page } = app
    await app.open({ route: '/accounts?settings=connection' })
    const dialog = settingsDialog(page)
    await expect(dialog.getByRole('heading', { name: 'SimpleFIN' })).toBeVisible()
    await expect(dialog.getByText(/Last synced Sep 24, 2026/)).toBeVisible()

    await dialog.getByRole('button', { name: 'Disconnect' }).click()
    const confirm = page.getByRole('dialog', { name: 'Disconnect SimpleFIN?' })
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(confirm).toBeHidden()
    expect(await app.sql('SELECT id FROM connections')).toHaveLength(1)

    await dialog.getByRole('button', { name: 'Disconnect' }).click()
    await page
      .getByRole('dialog', { name: 'Disconnect SimpleFIN?' })
      .getByRole('button', { name: 'Disconnect' })
      .click()
    await expect(dialog.getByRole('heading', { name: 'Connect SimpleFIN' })).toBeVisible()
    expect(await app.sql('SELECT id FROM connections')).toHaveLength(0)
    const [{ n }] = await app.sql<{ n: number }>('SELECT count(*) AS n FROM accounts')
    expect(n).toBeGreaterThan(0)
  })

  test('connecting a demo token through the input brings the accounts in', async ({ app }) => {
    const { page } = app
    await app.open({ dataset: 'none' })
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await settingsDialog(page).getByRole('button', { name: 'Connection' }).click()
    const dialog = settingsDialog(page)
    const connect = dialog.getByRole('button', { name: 'Connect', exact: true })
    await expect(connect).toBeDisabled()
    await dialog.getByLabel('Setup token').fill('demo:starter')
    await connect.click()

    await expect(dialog.getByRole('heading', { name: 'SimpleFIN' })).toBeVisible()
    await expect.poll(async () => (await app.sql('SELECT id FROM accounts')).length).toBe(2)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('row', { name: /Cash Back Card/ })).toBeVisible()
    await expect(page.getByRole('row', { name: /Checking/ })).toBeVisible()
  })

  test('a bad token shows the error and keeps the input', async ({ app }) => {
    const { page } = app
    await app.open({ dataset: 'none' })
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await settingsDialog(page).getByRole('button', { name: 'Connection' }).click()
    const dialog = settingsDialog(page)
    await dialog.getByLabel('Setup token').fill('demo:nope')
    await dialog.getByRole('button', { name: 'Connect', exact: true }).click()
    await expect(dialog.locator('p.text-destructive')).toBeVisible()
    await expect(dialog.getByLabel('Setup token')).toHaveValue('demo:nope')
    expect(await app.sql('SELECT id FROM connections')).toHaveLength(0)
  })

  test('Getting started guide replays the onboarding', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/accounts?settings=connection' })
    await expect.poll(() => storedSetting(app, 'onboardingComplete')).toBe(true)
    await settingsDialog(page).getByRole('button', { name: 'Show again' }).click()
    await expect(page.getByRole('dialog', { name: 'Welcome to shmoney!' })).toBeVisible()
    await expect.poll(() => storedSetting(app, 'onboardingComplete')).toBe(false)
  })
})

test.describe('Storage and About', () => {
  test('Storage shows the database size', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/accounts?settings=storage' })
    const dialog = settingsDialog(page)
    await expect(dialog.getByText(/^\d+(\.\d)? (KB|MB|GB)$/).first()).toBeVisible()
  })

  test('About shows the version and opens the licenses page', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/accounts?settings=about' })
    const dialog = settingsDialog(page)
    await expect(dialog.getByText(/^v\d+\.\d+\.\d+/)).toBeVisible()
    await expect(
      dialog.getByText('Automatic updates are disabled in development builds.')
    ).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Check for updates' })).toBeDisabled()

    await dialog.getByRole('button', { name: 'View licenses' }).click()
    await expect(dialog.getByText(/ships with \d+ open source packages/)).toBeVisible()
  })

  test('the web demo omits the update row', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/accounts?settings=about', desktop: false })
    const dialog = settingsDialog(page)
    await expect(dialog.getByRole('button', { name: 'View licenses' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Check for updates' })).toBeHidden()
  })

  test('Report bug previews the diagnostics and goes back', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/accounts?settings=about' })
    const dialog = settingsDialog(page)
    await dialog.getByRole('button', { name: 'Report bug' }).click()
    await expect(dialog.getByRole('heading', { name: 'Report a bug' })).toBeVisible()
    await expect(dialog.getByText('Collecting diagnostics…')).toBeHidden()
    await expect(dialog.locator('pre')).not.toBeEmpty()
    await expect(
      dialog.getByRole('button', { name: 'Copy diagnostics and open GitHub' })
    ).toBeEnabled()
    await dialog.getByRole('button', { name: 'Back to About' }).click()
    await expect(dialog.getByRole('button', { name: 'Report bug' })).toBeVisible()
  })
})
