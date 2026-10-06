import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../fixtures'

const STEP_TITLES = [
  'Welcome to shmoney!',
  'What you can do',
  'Choose your AI model',
  'Budget with envelopes',
  'Connect with SimpleFIN',
  'Paste your setup token'
]

const dialog = (page: Page): Locator => page.getByRole('dialog')
const next = (page: Page): Locator => dialog(page).getByRole('button', { name: 'Next' })

async function toLastStep(page: Page): Promise<void> {
  for (let i = 1; i < STEP_TITLES.length; i++) await next(page).click()
  await expect(dialog(page).getByText(STEP_TITLES.at(-1)!)).toBeVisible()
}

const onboardingComplete = async (app: {
  sql: <T>(q: string) => Promise<T[]>
}): Promise<boolean> => {
  const rows = await app.sql<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'onboardingComplete'"
  )
  return rows.length > 0 && JSON.parse(rows[0].value) === true
}

test.describe('first run', () => {
  test.beforeEach(async ({ app }) => {
    await app.open({ dataset: 'none', onboarding: true })
  })

  test('opens on the welcome step with Skip and no Back', async ({ app }) => {
    const { page } = app
    await expect(dialog(page).getByText(STEP_TITLES[0])).toBeVisible()
    await expect(dialog(page).getByText('Private by design.')).toBeVisible()
    await expect(dialog(page).getByRole('button', { name: 'Skip' })).toBeVisible()
    await expect(dialog(page).getByRole('button', { name: 'Back' })).toBeHidden()
    expect(await onboardingComplete(app)).toBe(false)
  })

  test('Escape and clicks outside do not dismiss it', async ({ app }) => {
    const { page } = app
    await page.keyboard.press('Escape')
    await page.mouse.click(5, 5)
    await expect(dialog(page).getByText(STEP_TITLES[0])).toBeVisible()
    expect(await onboardingComplete(app)).toBe(false)
  })

  test('Next and Back walk through the steps', async ({ app }) => {
    const { page } = app
    for (const title of STEP_TITLES.slice(1)) {
      await next(page).click()
      await expect(dialog(page).getByText(title)).toBeVisible()
      await expect(dialog(page).getByRole('button', { name: 'Back' })).toBeVisible()
      await expect(dialog(page).getByRole('button', { name: 'Skip' })).toBeHidden()
    }
    // the last step swaps Next for Connect, which waits for a token
    await expect(next(page)).toBeHidden()
    await expect(dialog(page).getByRole('button', { name: 'Connect' })).toBeDisabled()

    for (const title of STEP_TITLES.slice(0, -1).reverse()) {
      await dialog(page).getByRole('button', { name: 'Back' }).click()
      await expect(dialog(page).getByText(title)).toBeVisible()
    }
    await expect(dialog(page).getByRole('button', { name: 'Back' })).toBeHidden()
  })

  test('the model step embeds the model picker', async ({ app }) => {
    const { page } = app
    await next(page).click()
    await next(page).click()
    await expect(dialog(page).getByText(STEP_TITLES[2])).toBeVisible()
    await expect(dialog(page).getByRole('radiogroup').first()).toBeVisible()
    await expect(dialog(page).getByRole('radio', { name: 'Qwen3.5 9B' })).toBeVisible()
    await expect(dialog(page).getByText('Recommended', { exact: true })).toBeVisible()
  })

  test('Skip completes onboarding', async ({ app }) => {
    const { page } = app
    await dialog(page).getByRole('button', { name: 'Skip' }).click()
    await expect(dialog(page)).toBeHidden()
    await expect.poll(() => onboardingComplete(app)).toBe(true)
    await expect(page.getByText('No accounts yet')).toBeVisible()
  })

  test('the close button completes onboarding from any step', async ({ app }) => {
    const { page } = app
    await next(page).click()
    await dialog(page).getByRole('button', { name: 'Close' }).click()
    await expect(dialog(page)).toBeHidden()
    await expect.poll(() => onboardingComplete(app)).toBe(true)
  })

  test('a setup token connects, syncs and lands on the accounts', async ({ app }) => {
    const { page } = app
    await toLastStep(page)
    const connect = dialog(page).getByRole('button', { name: 'Connect' })
    await expect(connect).toBeDisabled()

    await dialog(page).getByLabel('Setup token').fill('demo:starter')
    await expect(connect).toBeEnabled()
    await connect.click()

    await expect(dialog(page).getByText("You're all set!")).toBeVisible()
    await expect(dialog(page).getByText('Accounts synced')).toBeVisible()
    await expect(dialog(page).getByRole('button', { name: 'Back' })).toBeHidden()

    await dialog(page).getByRole('button', { name: 'View accounts' }).click()
    await expect(dialog(page)).toBeHidden()
    await expect(page).toHaveURL(/#\/accounts/)
    await expect.poll(() => onboardingComplete(app)).toBe(true)

    const [{ n }] = await app.sql<{ n: number }>('SELECT count(*) AS n FROM accounts')
    expect(n).toBeGreaterThan(0)
    await expect(page.getByText('No accounts yet')).toBeHidden()
    await expect(page.getByRole('row', { name: /Checking/ }).first()).toBeVisible()
  })

  test('a bad setup token shows the error and stays on the step', async ({ app }) => {
    const { page } = app
    await toLastStep(page)
    await dialog(page).getByLabel('Setup token').fill('demo:nonsense')
    await dialog(page).getByRole('button', { name: 'Connect' }).click()
    await expect(dialog(page).locator('p.text-destructive')).toBeVisible()
    await expect(dialog(page).getByRole('button', { name: 'Connect' })).toBeEnabled()
    expect(await onboardingComplete(app)).toBe(false)
  })
})

test.describe('replay', () => {
  test('Settings > Connection "Getting started guide" reopens it from the top', async ({ app }) => {
    const { page } = app
    await app.open({ route: '/accounts?settings=connection' })
    await expect(dialog(page).getByText('Getting started guide')).toBeVisible()
    expect(await onboardingComplete(app)).toBe(true)

    await dialog(page).getByRole('button', { name: 'Show again' }).click()
    await expect(page.getByText(STEP_TITLES[0])).toBeVisible()
    await expect.poll(() => onboardingComplete(app)).toBe(false)
  })

  test('an already connected install skips the token step to the connected state', async ({
    app
  }) => {
    const { page } = app
    await app.open({ route: '/accounts?settings=connection' })
    await page.getByRole('button', { name: 'Show again' }).click()
    await expect(page.getByText(STEP_TITLES[0])).toBeVisible()

    const onboarding = page.getByRole('dialog').last()
    for (let i = 1; i < STEP_TITLES.length; i++)
      await onboarding.getByRole('button', { name: 'Next' }).click()
    await expect(onboarding.getByText("You're all set!")).toBeVisible()
    await onboarding.getByRole('button', { name: 'View accounts' }).click()
    await expect.poll(() => onboardingComplete(app)).toBe(true)
  })
})
