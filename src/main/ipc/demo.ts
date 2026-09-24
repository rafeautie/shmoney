import { ipcMain } from 'electron'
import { DEMO_IPC, demoDatasetIdSchema, type DemoDataset } from '@shared/demo'
import { listDatasets } from '../demo-data'
import { clearData, seedDataset } from '../demo-data/seed'

// Seeding replaces every row, so the desktop app only registers this in dev
// (the Debug page); the web demo always does.
export function registerDemoIpc(): void {
  ipcMain.handle(DEMO_IPC.datasets, (): DemoDataset[] => listDatasets())
  ipcMain.handle(DEMO_IPC.seed, (_event, input: unknown): Promise<void> =>
    seedDataset(demoDatasetIdSchema.parse(input))
  )
  ipcMain.handle(DEMO_IPC.clear, (): void => clearData())
}
