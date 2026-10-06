import { test as base, expect, type Page } from '@playwright/test'
import type { ShmoneyTestBridge } from '../src/demo/e2e/bridge'

// Every test opens a fresh app: the demo's database lives in the page, so a
// navigation is a clean install. The clock is pinned before boot because the
// sample datasets are generated relative to today.

export const FIXED_NOW = new Date('2026-09-24T12:00:00-04:00')

export interface OpenOptions {
  /** hash route, e.g. '/budget' or '/accounts?tab=transactions' */
  route?: string
  dataset?: 'household' | 'starter' | 'none'
  theme?: 'light' | 'dark'
  /** render like the desktop app (model gates, desktop-only settings); false shows the web demo */
  desktop?: boolean
  /** keep the first-run onboarding dialog instead of skipping it on an empty dataset */
  onboarding?: boolean
}

export interface App {
  page: Page
  open: (options?: OpenOptions) => Promise<void>
  /** runs `fn` against window.__shmoney inside the page */
  bridge: <T, A = undefined>(fn: (bridge: ShmoneyTestBridge, arg: A) => T, arg?: A) => Promise<T>
  sql: <T = Record<string, unknown>>(text: string) => Promise<T[]>
  /** the platform shortcut modifier the app listens for */
  mod: string
}

export const test = base.extend<{ app: App }>({
  app: async ({ page }, use) => {
    const errors: Error[] = []
    page.on('pageerror', (error) => errors.push(error))

    const app: App = {
      page,
      mod: process.platform === 'darwin' ? 'Meta' : 'Control',
      async open({
        route = '/accounts',
        dataset = 'household',
        theme = 'light',
        desktop = true,
        onboarding = false
      } = {}) {
        await page.clock.install({ time: FIXED_NOW })
        const mode = desktop ? 'shot=1' : 'bar=0'
        await page.goto(`/?dataset=${dataset}&theme=${theme}&${mode}#${route}`)
        await page.waitForFunction(() => '__shmoney' in window && !!document.querySelector('main'))
        if (dataset === 'none' && !onboarding) {
          await page.getByRole('button', { name: 'Skip' }).click()
          await expect(page.getByRole('dialog')).toBeHidden()
        }
      },
      // the function crosses as source text; an evaluated expression isn't held
      // to the page's no-eval CSP the way new Function would be
      bridge: (fn, arg) =>
        page.evaluate(`(${fn.toString()})(window.__shmoney, ${JSON.stringify(arg ?? null)})`),
      sql: (text) => app.bridge((b, q: string) => b.sql(q), text) as never
    }

    await use(app)
    expect(errors, 'uncaught errors in the page').toEqual([])
  }
})

export { expect }
