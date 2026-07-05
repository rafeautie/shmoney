import { z } from 'zod'

// one entry per user preference; adding a setting = a line here + a default below
export const settingSchemas = {
  theme: z.enum(['light', 'dark']),
  blurAmounts: z.boolean(),
  sidebarOpen: z.boolean(),
  // auto-detect inter-account transfers on sync (see the transfer detector)
  detectTransfers: z.boolean(),
  // run user-defined rules automatically on sync (see the rules engine)
  applyRulesOnSync: z.boolean()
}

export type SettingKey = keyof typeof settingSchemas
export type Settings = { [K in SettingKey]: z.infer<(typeof settingSchemas)[K]> }

export const settingKeySchema = z.enum(Object.keys(settingSchemas) as [SettingKey, ...SettingKey[]])

export const SETTINGS_DEFAULTS: Settings = {
  theme: 'dark',
  blurAmounts: false,
  sidebarOpen: true,
  detectTransfers: true,
  applyRulesOnSync: true
}

export const SETTINGS_IPC = {
  getAll: 'settings:getAll',
  set: 'settings:set'
} as const
