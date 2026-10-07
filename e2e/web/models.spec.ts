import type { Locator, Page } from '@playwright/test'
import { expect, test, type App } from '../fixtures'

const GIB = 1024 ** 3

const dialog = (page: Page): Locator => page.getByRole('dialog', { name: 'Settings' })
const model = (page: Page, label: string): Locator =>
  dialog(page).getByRole('radio', { name: label })

// The hardware query is cached for the session and the root already read it at
// boot, so a scripted RAM only shows once a model action refetches the llm
// queries; cancelling a pretend download is the cheapest such action
async function openAiSettings(app: App, options: { ramBytes?: number } = {}): Promise<void> {
  const { page } = app
  await app.open({ route: '/accounts' })
  await page.evaluate(() => {
    window.location.hash = '#/accounts?settings=ai'
  })
  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page).getByText('Local AI model')).toBeVisible()
  if (options.ramBytes === undefined) return

  await app.bridge((b, bytes: number) => {
    b.llm.setRam(bytes)
    b.llm.setStage('downloading')
  }, options.ramBytes)
  await model(page, 'Qwen3.5 4B').getByRole('button', { name: 'Cancel' }).click()
}

test('the picker lists the model families and recommends one model', async ({ app }) => {
  const { page } = app
  await app.open({ route: '/accounts?settings=ai' })
  await expect(dialog(page).getByText('Local AI model')).toBeVisible()

  await expect(dialog(page).getByRole('heading', { name: /Gemma 4/ })).toBeVisible()
  await expect(dialog(page).getByRole('heading', { name: /Qwen3\.5/ })).toBeVisible()
  await expect(dialog(page).getByRole('radio')).toHaveCount(6)

  // the selected model defaults to the vetted 4B; the recommendation is the 9B
  await expect(model(page, 'Qwen3.5 4B')).toHaveAttribute('aria-checked', 'true')
  await expect(dialog(page).getByText('Recommended', { exact: true })).toHaveCount(1)
  await expect(model(page, 'Qwen3.5 9B').getByText('Recommended')).toBeVisible()
  for (const label of ['Qwen3.5 2B', 'Gemma 4 E2B', 'Gemma 4 E4B', 'Gemma 4 12B']) {
    await expect(model(page, label)).toHaveAttribute('aria-checked', 'false')
    await expect(model(page, label).getByRole('button', { name: 'Download' })).toBeVisible()
  }
  await expect(model(page, 'Qwen3.5 4B')).toContainText('3.5 GB')
})

test('downloading a model selects it, completes, and announces it ready', async ({ app }) => {
  const { page } = app
  await openAiSettings(app)

  await model(page, 'Qwen3.5 9B').getByRole('button', { name: 'Download' }).click()
  await expect(model(page, 'Qwen3.5 9B')).toHaveAttribute('aria-checked', 'true')
  await expect(model(page, 'Qwen3.5 9B')).toContainText('5.7 GB on disk')
  await expect(model(page, 'Qwen3.5 9B').getByRole('button', { name: 'Delete' })).toBeVisible()
  await expect(model(page, 'Qwen3.5 4B')).toHaveAttribute('aria-checked', 'false')
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: 'Qwen3.5 9B ready' })
  ).toBeVisible()

  const status = await page.evaluate(() => window.api.llm.getStatus())
  expect(status.selected).toBe('qwen35-9b')
  expect(status.models['qwen35-9b'].stage).toBe('downloaded')
})

test('a download in flight shows progress and can be cancelled; verifying cannot', async ({
  app
}) => {
  const { page } = app
  await openAiSettings(app)
  const row = model(page, 'Qwen3.5 4B')

  await app.bridge((b) => b.llm.setStage('downloading'))
  await expect(row.getByText('Starting')).toBeVisible()
  await expect(row.getByRole('progressbar')).toBeVisible()
  await expect(row.getByRole('button', { name: 'Download' })).toBeHidden()

  await app.bridge((b) => b.llm.setStage('verifying'))
  await expect(row.getByText('Verifying')).toBeVisible()
  await expect(row.getByRole('button', { name: 'Cancel' })).toBeHidden()

  await app.bridge((b) => b.llm.setStage('downloading'))
  await row.getByRole('button', { name: 'Cancel' }).click()
  await expect(row.getByRole('button', { name: 'Download' })).toBeVisible()
  await expect(row.getByRole('progressbar')).toBeHidden()
})

test('a failed download shows its error and offers Retry', async ({ app }) => {
  const { page } = app
  await openAiSettings(app)
  const row = model(page, 'Qwen3.5 4B')

  await app.bridge((b) => b.llm.setStage('error'))
  await expect(row.getByText('Download failed')).toBeVisible()
  await row.getByRole('button', { name: 'Retry' }).click()
  await expect(row).toContainText('3.5 GB on disk')
})

test('deleting a downloaded model asks first, then returns it to not downloaded', async ({
  app
}) => {
  const { page } = app
  await openAiSettings(app)
  await app.bridge((b) => b.llm.ready())
  const row = model(page, 'Qwen3.5 4B')
  await expect(row).toContainText('3.5 GB on disk')

  await row.getByRole('button', { name: 'Delete' }).click()
  const confirm = page.getByRole('dialog').filter({ hasText: 'Delete Qwen3.5 4B?' })
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  await expect(confirm).toBeHidden()
  await expect(row.getByRole('button', { name: 'Delete' })).toBeVisible()

  await row.getByRole('button', { name: 'Delete' }).click()
  await confirm.getByRole('button', { name: /^Delete/ }).click()
  await expect(row.getByRole('button', { name: 'Download' })).toBeVisible()
  await expect(row.getByRole('button', { name: 'Delete' })).toBeHidden()
  const status = await page.evaluate(() => window.api.llm.getStatus())
  expect(status.models['qwen35-4b'].stage).toBe('notDownloaded')
})

test('clicking another runnable model makes it the selected one', async ({ app }) => {
  const { page } = app
  await openAiSettings(app)
  await app.bridge((b) => {
    b.llm.setStage('downloaded', 'qwen35-4b')
    b.llm.setStage('downloaded', 'e4b')
  })
  await expect(model(page, 'Gemma 4 E4B')).toContainText('on disk')

  await model(page, 'Gemma 4 E4B').click()
  await expect(model(page, 'Gemma 4 E4B')).toHaveAttribute('aria-checked', 'true')
  await expect(model(page, 'Qwen3.5 4B')).toHaveAttribute('aria-checked', 'false')
  expect((await page.evaluate(() => window.api.llm.getStatus())).selected).toBe('e4b')

  await model(page, 'Qwen3.5 4B').focus()
  await page.keyboard.press('Enter')
  await expect(model(page, 'Qwen3.5 4B')).toHaveAttribute('aria-checked', 'true')
})

test('a middling machine folds the models it cannot run behind Show more', async ({ app }) => {
  const { page } = app
  await openAiSettings(app, { ramBytes: 8 * GIB })

  await expect(dialog(page).getByRole('radio')).toHaveCount(3)
  await expect(model(page, 'Gemma 4 E4B')).toBeHidden()
  await expect(model(page, 'Qwen3.5 4B').getByText('Recommended')).toBeVisible()
  await expect(dialog(page).getByText('On-device AI is off on this device')).toBeHidden()

  await dialog(page)
    .getByRole('button', { name: /Show 3 more/ })
    .click()
  await expect(dialog(page).getByRole('radio')).toHaveCount(6)
  const large = model(page, 'Qwen3.5 9B')
  await expect(large).toContainText('Needs more memory')
  await expect(large).toHaveAttribute('aria-disabled', 'true')
  await expect(large.getByRole('button', { name: 'Download' })).toBeHidden()

  // an unrunnable model can't be selected
  await large.click({ force: true })
  await expect(model(page, 'Qwen3.5 4B')).toHaveAttribute('aria-checked', 'true')

  await dialog(page)
    .getByRole('button', { name: /Hide models this device/ })
    .click()
  await expect(dialog(page).getByRole('radio')).toHaveCount(3)
})

test('too little memory shows the unsupported warning and turns chat off', async ({ app }) => {
  const { page } = app
  await openAiSettings(app, { ramBytes: 4 * GIB })

  await expect(dialog(page).getByText('On-device AI is off on this device')).toBeVisible()
  // only the selected model stays listed, marked as needing more memory
  await expect(dialog(page).getByRole('radio')).toHaveCount(1)
  await expect(model(page, 'Qwen3.5 4B')).toContainText('Needs more memory')
  await expect(dialog(page).getByText('Recommended', { exact: true })).toBeHidden()
  await dialog(page)
    .getByRole('button', { name: /Show 5 more/ })
    .click()
  await expect(dialog(page).getByRole('radio')).toHaveCount(6)

  await page.keyboard.press('Escape')
  await expect(dialog(page)).toBeHidden()
  await page.getByRole('link', { name: 'New chat' }).click()
  await expect(page.getByText("Chat isn't available on this device")).toBeVisible()
  await expect(page.getByRole('button', { name: 'Download' })).toBeHidden()
})

test('AI usage starts empty', async ({ app }) => {
  const { page } = app
  await app.open({ route: '/accounts?settings=ai-usage' })

  await expect(dialog(page).getByText('No AI usage yet')).toBeVisible()
  await expect(dialog(page).getByRole('button', { name: 'Reset statistics' })).toBeHidden()
  await expect(dialog(page).getByText('By model')).toBeHidden()
})

test('AI usage summarizes logged requests, and Reset statistics can be undone', async ({ app }) => {
  const { page } = app
  await app.open({ route: '/accounts' })
  const at = await page.evaluate(() => Date.now())
  await app.sql(
    `INSERT INTO llm_usage (created_at, model_id, feature, stop_reason, input_tokens, output_tokens,
       decode_tokens, decode_ms, prefill_ms, tool_ms, total_ms, ttft_ms, load_ms)
     VALUES (${at}, 'qwen35-4b', 'chat', 'endOfTurn', 1200, 80, 80, 2000, 400, 0, 2400, 400, NULL),
            (${at}, 'qwen35-4b', 'categorize', 'endOfTurn', 800, 40, 40, 1000, 300, 0, 1300, 300, NULL)`
  )
  await page.evaluate(() => {
    window.location.hash = '#/accounts?settings=ai-usage'
  })

  const usage = dialog(page)
  await expect(usage.getByText('No AI usage yet')).toBeHidden()
  await expect(usage.getByText('120', { exact: true })).toBeVisible()
  await expect(usage.getByText('Tokens generated')).toBeVisible()
  await expect(usage.getByRole('cell', { name: 'Qwen3.5 4B' })).toBeVisible()
  await expect(usage.getByRole('cell', { name: 'Auto-categorize' })).toBeVisible()

  await usage.getByRole('button', { name: 'Reset statistics' }).click()
  await expect(usage.getByText('No AI usage yet')).toBeVisible()
  const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'AI usage statistics reset' })
  await expect(toast).toBeVisible()
  // reset is soft: the ledger itself keeps its rows
  const [{ n }] = await app.sql<{ n: number }>('SELECT count(*) AS n FROM llm_usage')
  expect(n).toBe(2)

  await toast.getByRole('button', { name: 'Undo' }).click()
  await expect(usage.getByText('No AI usage yet')).toBeHidden()
  await expect(usage.getByRole('cell', { name: 'Qwen3.5 4B' })).toBeVisible()
})
