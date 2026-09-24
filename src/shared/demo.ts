import { z } from 'zod'

// sample datasets: the web demo's content and the dev app's reproducible data.
// Seeding connects a `demo:<id>` SimpleFIN token, so it runs the real sync path.
export interface DemoDataset {
  id: string
  name: string
  description: string
}

export const DEMO_TOKEN_PREFIX = 'demo:'

export const demoDatasetIdSchema = z.string().min(1)

export const DEMO_IPC = {
  datasets: 'demo:datasets',
  seed: 'demo:seed',
  clear: 'demo:clear'
} as const
