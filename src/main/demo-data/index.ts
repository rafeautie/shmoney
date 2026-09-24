import type { DemoDataset } from '@shared/demo'
import type { SfinAccountSet } from '../simplefin'
import { household } from './household'
import { starter } from './starter'
import type { DatasetDefinition } from './types'

export const DATASETS: DatasetDefinition[] = [household, starter]

export function listDatasets(): DemoDataset[] {
  return DATASETS.map(({ id, name, description }) => ({ id, name, description }))
}

export function getDataset(id: string): DatasetDefinition {
  const dataset = DATASETS.find((d) => d.id === id)
  if (!dataset) throw new Error(`Unknown demo dataset "${id}"`)
  return dataset
}

/** What the demo bridge answers /accounts with; always the full history. */
export function demoAccountSet(id: string, now = new Date()): SfinAccountSet {
  return getDataset(id).accountSet(now)
}
