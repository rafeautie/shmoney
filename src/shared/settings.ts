import { z } from 'zod'
import { ACTION_SOURCES } from './ipc'

// Interface size steps; 1.2 matches the Claude desktop app at its common zoom
export const UI_SCALES = [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.5] as const
export type UiScale = (typeof UI_SCALES)[number]

/** The neighboring step in a direction, clamped at the ends; 0 resets. */
export function nextUiScale(current: UiScale, direction: -1 | 0 | 1): UiScale {
  if (direction === 0) return 1
  const index = UI_SCALES.indexOf(current) + direction
  return UI_SCALES[Math.min(Math.max(index, 0), UI_SCALES.length - 1)]
}

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
  // fingerprint of the enabled rules the last accepted-suggestion heal ran against
  ruleSuggestionsHealedFor: z.string().nullable(),
  // whether the first-run onboarding dialog has been finished or skipped
  onboardingComplete: z.boolean(),
  // newest automated Activity entry the user has seen; drives the Activity nav dot
  activitySeenAt: z.number().nullable(),
  // the Activity page's source filter; null = everything
  activitySource: z.enum(ACTION_SOURCES).nullable(),
  // how the Goals page lists goals: editable cards or one row each
  goalsView: z.enum(['cards', 'table']),
  // the same choice for the Budget page's envelopes
  budgetView: z.enum(['cards', 'table']),
  // date-sorted transaction tables group rows under sticky day headers
  groupTransactionsByDay: z.boolean(),
  // AI usage stats count from here (unix ms); resetting moves it, rows stay
  llmUsageSince: z.number().nullable(),
  // page zoom for the whole interface; the type and spacing tokens stay at 1x
  uiScale: z.literal(UI_SCALES)
}

export type SettingKey = keyof typeof settingSchemas
export type Settings = { [K in SettingKey]: z.infer<(typeof settingSchemas)[K]> }

export type SettingChange = { [K in SettingKey]: { key: K; value: Settings[K] } }[SettingKey]

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
  ruleSuggestionsHealedFor: null,
  onboardingComplete: false,
  activitySeenAt: null,
  activitySource: null,
  goalsView: 'cards',
  // the envelope table is what the page has always opened as
  budgetView: 'table',
  groupTransactionsByDay: true,
  llmUsageSince: null,
  uiScale: 1
}

export const SETTINGS_IPC = {
  getAll: 'settings:getAll',
  set: 'settings:set',
  // main changed a setting itself (zoom shortcuts); payload { key, value }
  changed: 'settings:changed'
} as const
