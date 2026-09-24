import { queryClient } from './query-client'

// Sample-data actions shared by the Debug page and the web demo. Seeding
// rewrites every table, so every cached read goes stale at once.

export async function seedDataset(id: string): Promise<void> {
  await window.api.demo.seed(id)
  await queryClient.invalidateQueries()
}

export async function clearData(): Promise<void> {
  await window.api.demo.clear()
  await queryClient.invalidateQueries()
}
