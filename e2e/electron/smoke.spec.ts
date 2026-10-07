import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { expect, seed, test } from './fixtures'

test('a fresh profile migrates, shows onboarding, and keeps data across a restart', async ({
  desktop
}) => {
  const first = await desktop.launch()
  await expect(first.window.getByRole('dialog')).toBeVisible()
  expect(existsSync(join(desktop.dataDir, 'shmoney.db'))).toBe(true)

  await seed(first.window, 'starter')
  await expect(first.window.getByRole('row', { name: /Checking/ })).toBeVisible()
  await desktop.closeAll()

  const second = await desktop.launch()
  await expect(second.window.getByRole('row', { name: /Checking/ })).toBeVisible()
  await expect(second.window.getByRole('dialog')).toBeHidden()
})
