import { expect, test } from '../fixtures'

test('boots with the household dataset and navigates the main pages', async ({ app }) => {
  const { page } = app
  await app.open()
  await expect(page.getByText('Net worth', { exact: true })).toBeVisible()
  await expect(page.getByRole('row', { name: /Everyday Checking/ })).toBeVisible()

  for (const name of ['Budget', 'Goals', 'Reports', 'Activity']) {
    await page.getByRole('link', { name, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`#/${name.toLowerCase()}`))
  }
})

test('the bridge reads the database and scripts the model', async ({ app }) => {
  await app.open({ dataset: 'starter' })
  const [{ n }] = await app.sql<{ n: number }>('SELECT count(*) AS n FROM accounts')
  expect(n).toBeGreaterThan(0)
  await app.bridge((b) => b.llm.ready())
  const status = await app.page.evaluate(() => window.api.llm.getStatus())
  expect(status.models[status.selected].stage).toBe('downloaded')
})

test('an empty install skips onboarding into the empty accounts page', async ({ app }) => {
  await app.open({ dataset: 'none' })
  await expect(app.page.getByText('No accounts yet')).toBeVisible()
})
