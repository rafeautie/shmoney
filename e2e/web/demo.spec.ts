import type { Frame, FrameLocator, Page } from '@playwright/test'
import { SCREENS } from '../../src/demo/screens'
import { expect, FIXED_NOW, test } from '../fixtures'

// These tests build the demo URL themselves to cover the embed parameters, so
// they bypass app.open (which always passes dataset, theme and bar/shot).

async function openDemo(page: Page, query: string, hash = ''): Promise<void> {
  await page.clock.install({ time: FIXED_NOW })
  await page.goto(`/?${query}${hash}`)
  await page.waitForFunction(() => '__shmoney' in window && !!document.querySelector('main'))
}

const accountCount = (page: Page): Promise<number> =>
  page.evaluate(() => window.__shmoney.sql('SELECT count(*) AS n FROM accounts')[0].n as number)

test.describe('demo bar', () => {
  test('shows the sample-data controls by default', async ({ app }) => {
    const { page } = app
    await openDemo(page, '', '#/accounts')
    await expect(page.getByText('Sample data', { exact: true })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Sample dataset' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Load' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Clear' })).toBeEnabled()
    // household is the default dataset
    await expect(page.getByRole('row', { name: /Everyday Checking/ })).toBeVisible()
  })

  test('bar=0 hides it', async ({ app }) => {
    const { page } = app
    await openDemo(page, 'bar=0', '#/accounts')
    await expect(page.getByRole('row', { name: /Everyday Checking/ })).toBeVisible()
    await expect(page.getByText('Sample data', { exact: true })).toBeHidden()
    await expect(page.getByRole('button', { name: 'Load' })).toBeHidden()
  })

  test('shot=1 renders without the bar too', async ({ app }) => {
    const { page } = app
    await openDemo(page, 'shot=1', '#/accounts')
    await expect(page.getByRole('row', { name: /Everyday Checking/ })).toBeVisible()
    await expect(page.getByText('Sample data', { exact: true })).toBeHidden()
    await expect(page.locator('html')).toHaveAttribute('data-shot', '')
  })

  test('Clear empties the app and Load fills it with the chosen dataset', async ({ app }) => {
    const { page } = app
    await openDemo(page, '', '#/accounts')
    await expect.poll(() => accountCount(page)).toBe(4)

    await page.getByRole('button', { name: 'Clear' }).click()
    await expect(page.getByText('Cleared all data')).toBeVisible()
    await expect.poll(() => accountCount(page)).toBe(0)

    // a cleared install is a fresh one, so the first-run dialog is back
    await page.getByRole('dialog').getByRole('button', { name: 'Skip' }).click()
    await expect(page.getByText('No accounts yet')).toBeVisible()

    await page.getByRole('combobox', { name: 'Sample dataset' }).click()
    await page.getByRole('option', { name: 'Fresh start' }).click()
    await page.getByRole('button', { name: 'Load' }).click()
    await expect(page.getByText('Loaded Fresh start sample data')).toBeVisible()
    await expect.poll(() => accountCount(page)).toBe(2)
    await expect(page.getByRole('row', { name: /Cash Back Card/ })).toBeVisible()
  })
})

test.describe('embed parameters', () => {
  test('dataset=starter loads the fresh-start data', async ({ app }) => {
    const { page } = app
    await openDemo(page, 'dataset=starter&bar=0', '#/accounts')
    await expect(page.getByRole('row', { name: /Cash Back Card/ })).toBeVisible()
    await expect(page.getByRole('row', { name: /Everyday Checking/ })).toBeHidden()
    expect(await accountCount(page)).toBe(2)
  })

  test('dataset=none boots an empty install with the first-run dialog', async ({ app }) => {
    const { page } = app
    await openDemo(page, 'dataset=none&bar=0', '#/accounts')
    await expect(page.getByRole('dialog').getByText('Welcome to shmoney!')).toBeVisible()
    expect(await accountCount(page)).toBe(0)
  })

  test('theme=dark sets the dark class, theme=light clears it', async ({ app }) => {
    const { page } = app
    await openDemo(page, 'theme=dark&bar=0', '#/accounts')
    await expect(page.locator('html')).toHaveClass(/dark/)

    await openDemo(page, 'theme=light&bar=0', '#/accounts')
    await expect(page.locator('html')).not.toHaveClass(/dark/)
  })

  test('sidebar=collapsed starts with the sidebar collapsed', async ({ app }) => {
    const { page } = app
    await openDemo(page, 'sidebar=collapsed&bar=0', '#/accounts')
    await expect(page.locator('[data-slot="sidebar"][data-state]')).toHaveAttribute(
      'data-state',
      'collapsed'
    )
  })

  test('screen=budget opens the budget route and drops the parameters from the URL', async ({
    app
  }) => {
    const { page } = app
    await openDemo(page, 'screen=budget&bar=0')
    await expect(page).toHaveURL(/\/#\/budget$/)
    await expect(page).toHaveTitle('Budget · shmoney')
  })

  test('a query on a screen route survives into the hash', async ({ app }) => {
    const { page } = app
    await openDemo(page, 'screen=transactions&bar=0')
    await expect(page).toHaveURL(/#\/accounts\?tab=transactions/)
    await expect(page.getByPlaceholder('Search transactions...')).toBeVisible()
  })

  test('an unknown dataset id falls back to the household data', async ({ app }) => {
    const { page } = app
    await openDemo(page, 'dataset=nope&bar=0', '#/accounts')
    await expect(page.getByRole('row', { name: /Everyday Checking/ })).toBeVisible()
  })
})

test.describe('every named screen', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const screen of SCREENS) {
      test(`${screen.name} renders in ${theme}`, async ({ app }) => {
        const { page } = app
        await openDemo(page, `screen=${screen.name}&theme=${theme}&bar=0`)
        const main = page.locator('main')
        await expect(main).toBeVisible()
        await expect
          .poll(async () => (await main.innerText()).trim().length, { message: 'content rendered' })
          .toBeGreaterThan(40)
        await expect(page.getByText('Page not found')).toBeHidden()
        await expect(page.getByText('Something went wrong')).toBeHidden()
        if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/)
        else await expect(page.locator('html')).not.toHaveClass(/dark/)
        if (screen.name === 'settings-llm') {
          await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
        }
      })
    }
  }
})

test.describe('host page messages', () => {
  const HOST = `<!doctype html><meta charset="utf-8">
<script>
  window.events = []
  window.addEventListener('message', (e) => window.events.push(e.data))
</script>
<iframe id="demo" src="/?dataset=starter&bar=0#/accounts" style="width:1280px;height:800px;border:0"></iframe>`

  async function openHost(page: Page): Promise<FrameLocator> {
    await page.clock.install({ time: FIXED_NOW })
    // same origin as the demo, which allows localhost hosts
    await page.route('**/host.html', (route) =>
      route.fulfill({ contentType: 'text/html', body: HOST })
    )
    await page.goto('/host.html')
    const frame = page.frameLocator('#demo')
    await expect(frame.getByRole('row', { name: /Cash Back Card/ })).toBeVisible()
    return frame
  }

  const send = (page: Page, message: Record<string, unknown>): Promise<void> =>
    page.evaluate((m) => {
      const frame = document.querySelector<HTMLIFrameElement>('#demo')!
      frame.contentWindow!.postMessage({ type: 'shmoney-demo', ...m }, location.origin)
    }, message)

  const demoFrame = (page: Page): Frame => page.frames().find((f) => f !== page.mainFrame())!

  const events = (page: Page): Promise<unknown[]> =>
    page.evaluate(
      () => (window as unknown as { events: Record<string, unknown>[] }).events as unknown[]
    )

  test('posts ready, then a route event per navigation', async ({ app }) => {
    const { page } = app
    await openHost(page)
    await expect
      .poll(() => events(page))
      .toContainEqual({ type: 'shmoney-demo', event: 'ready', route: '/accounts' })

    await send(page, { action: 'navigate', to: '/budget' })
    await expect
      .poll(() => events(page))
      .toContainEqual({ type: 'shmoney-demo', event: 'route', route: '/budget' })
  })

  test('navigate by route or by screen name changes the page', async ({ app }) => {
    const { page } = app
    const frame = await openHost(page)

    await send(page, { action: 'navigate', to: '/budget' })
    await expect.poll(() => demoFrame(page).url()).toMatch(/#\/budget/)
    await expect(frame.getByRole('link', { name: 'Budget', exact: true })).toHaveAttribute(
      'aria-current',
      'page'
    )

    await send(page, { action: 'navigate', screen: 'activity' })
    await expect.poll(() => demoFrame(page).url()).toMatch(/#\/activity/)
    await expect(frame.getByRole('link', { name: 'Activity', exact: true })).toHaveAttribute(
      'aria-current',
      'page'
    )
  })

  test('seed and clear replace the data', async ({ app }) => {
    const { page } = app
    const frame = await openHost(page)

    await send(page, { action: 'seed', dataset: 'household' })
    await expect(frame.getByRole('row', { name: /Everyday Checking/ })).toBeVisible()
    await expect(frame.getByRole('row', { name: /Cash Back Card/ })).toBeHidden()

    await send(page, { action: 'clear' })
    await expect(frame.getByText('No accounts yet')).toBeVisible()
  })

  test('theme switches the iframe between light and dark', async ({ app }) => {
    const { page } = app
    const frame = await openHost(page)
    await send(page, { action: 'theme', theme: 'dark' })
    await expect(frame.locator('html')).toHaveClass(/dark/)
    await send(page, { action: 'theme', theme: 'light' })
    await expect(frame.locator('html')).not.toHaveClass(/dark/)
  })

  test('messages that are not for the demo are ignored', async ({ app }) => {
    const { page } = app
    const frame = await openHost(page)
    await page.evaluate(() => {
      const frame = document.querySelector<HTMLIFrameElement>('#demo')!
      frame.contentWindow!.postMessage({ type: 'other', action: 'clear' }, location.origin)
      frame.contentWindow!.postMessage(
        { type: 'shmoney-demo', action: 'navigate', screen: 'no-such-screen' },
        location.origin
      )
    })
    // a later, valid message proves the earlier ones were processed and dropped
    await send(page, { action: 'navigate', to: '/goals' })
    await expect.poll(() => demoFrame(page).url()).toMatch(/#\/goals/)
    await expect(frame.getByRole('link', { name: 'Goals', exact: true })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(
      await demoFrame(page).evaluate(() => window.__shmoney.sql('SELECT id FROM accounts').length)
    ).toBe(2)
    expect(await events(page)).not.toContainEqual(
      expect.objectContaining({ event: 'route', route: '/no-such-screen' })
    )
  })
})
