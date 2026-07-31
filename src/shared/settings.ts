import { z } from 'zod'

// one entry per user preference; adding a setting = a line here + a default below
export const settingSchemas = {
  // 'system' defers to the OS; main mirrors this onto nativeTheme.themeSource,
  // which is what makes prefers-color-scheme in the renderer authoritative
  theme: z.enum(['light', 'dark', 'system']),
  blurAmounts: z.boolean(),
  sidebarOpen: z.boolean(),
  // last window rect and maximized state, restored on launch (null = first run)
  windowState: z
    .object({
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number(),
      height: z.number(),
      maximized: z.boolean()
    })
    .nullable(),
  // mirror completed background work to an OS notification while unfocused
  nativeNotifications: z.boolean(),
  // auto-detect inter-account transfers on sync (see the transfer detector)
  detectTransfers: z.boolean(),
  // run user-defined rules automatically on sync (see the rules engine)
  applyRulesOnSync: z.boolean(),
  // suggest new rules when identical transactions get categorized repeatedly
  ruleSuggestionsEnabled: z.boolean(),
  // whether the first-run onboarding dialog has been finished or skipped
  onboardingComplete: z.boolean()
}

export type SettingKey = keyof typeof settingSchemas
export type Settings = { [K in SettingKey]: z.infer<(typeof settingSchemas)[K]> }

export const settingKeySchema = z.enum(Object.keys(settingSchemas) as [SettingKey, ...SettingKey[]])

export const SETTINGS_DEFAULTS: Settings = {
  theme: 'dark',
  blurAmounts: false,
  sidebarOpen: true,
  windowState: null,
  nativeNotifications: true,
  detectTransfers: true,
  applyRulesOnSync: true,
  ruleSuggestionsEnabled: true,
  onboardingComplete: false
}

export const SETTINGS_IPC = {
  getAll: 'settings:getAll',
  set: 'settings:set'
} as const
