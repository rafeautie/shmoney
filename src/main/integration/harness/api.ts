import type { Api } from '../../../preload'

// The preload's window.api, as setup.ts exposed it. Specs call the app through
// this so the preload's channel wiring is under test too.
export const api = (globalThis as unknown as { api: Api }).api
