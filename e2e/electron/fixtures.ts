import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _electron as electron,
  test as base,
  expect,
  type ElectronApplication,
  type Page
} from '@playwright/test'

// Tier C: the built desktop app (npm run build) with its real SQLite file,
// keychain, windows and process lifecycle. Each test owns a fresh profile in
// a temp dir, so it shares no data, lock or window state with a dev instance
// or with other tests. Unpackaged, the app moves userData to `<dir>-dev` and
// registers the dev-only demo IPC, which seeds data.

export interface Desktop {
  /** the profile dir passed to --user-data-dir (the app writes to `${dir}-dev`) */
  dir: string
  /** where the app actually keeps its database, logs and models */
  dataDir: string
  /** launches the app on this test's profile; extra args reach process.argv */
  launch: (args?: string[]) => Promise<{ app: ElectronApplication; window: Page }>
  /** closes every app this test launched */
  closeAll: () => Promise<void>
}

export async function firstScreen(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow()
  await page.waitForFunction(() => !!document.querySelector('main'))
  return page
}

/** skips onboarding the way a returning user would have */
export async function seed(
  page: Page,
  dataset: 'household' | 'starter' = 'household'
): Promise<void> {
  await page.evaluate(async (id) => {
    await window.api.demo.seed(id)
    await window.api.settings.set('onboardingComplete', true)
  }, dataset)
  await page.reload()
  await page.waitForFunction(() => !!document.querySelector('main'))
}

export const test = base.extend<{ desktop: Desktop }>({
  // Playwright reads a fixture's dependencies from this pattern, so it must stay an object
  // eslint-disable-next-line no-empty-pattern
  desktop: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'shmoney-e2e-'))
    const apps: ElectronApplication[] = []
    const desktop: Desktop = {
      dir,
      dataDir: `${dir}-dev`,
      async launch(args = []) {
        const app = await electron.launch({
          args: ['.', `--user-data-dir=${dir}`, ...args],
          env: { ...process.env, ELECTRON_RENDERER_URL: '' }
        })
        apps.push(app)
        return { app, window: await firstScreen(app) }
      },
      async closeAll() {
        await Promise.all(apps.splice(0).map((app) => app.close().catch(() => {})))
      }
    }
    await use(desktop)
    await desktop.closeAll()
    for (const path of [dir, `${dir}-dev`]) rmSync(path, { recursive: true, force: true })
  }
})

export { expect }
