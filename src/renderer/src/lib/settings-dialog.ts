import { useCallback } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'

export const SETTINGS_SECTIONS = [
  'general',
  'connection',
  'categories',
  'rules',
  'ai',
  'ai-usage',
  'storage',
  'about'
] as const

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

// pages that open within a section's pane instead of as a dialog over Settings
export const SETTINGS_PAGES = ['licenses', 'report-bug', 'suggestions', 'apply-rules'] as const

export type SettingsPage = (typeof SETTINGS_PAGES)[number]

export function parseSettingsSection(value: unknown): SettingsSection | undefined {
  return SETTINGS_SECTIONS.find((s) => s === value)
}

export function parseSettingsPage(value: unknown): SettingsPage | undefined {
  return SETTINGS_PAGES.find((p) => p === value)
}

// The settings dialog's open section lives in a root search param
// (?settings=rules) so the macOS menu, in-app links, and demo screenshots can
// open it at a section over whatever page is showing. A sub-page within that
// section rides alongside (&settingsPage=suggestions).
export function useSettingsDialog(): {
  section: SettingsSection | undefined
  page: SettingsPage | undefined
  open: (section?: SettingsSection, page?: SettingsPage) => void
  close: () => void
} {
  const navigate = useNavigate()
  const section = useSearch({ strict: false, select: (s) => s.settings })
  const page = useSearch({ strict: false, select: (s) => s.settingsPage })

  const go = useCallback(
    (settings: SettingsSection | undefined, settingsPage: SettingsPage | undefined) =>
      void navigate({
        to: '.',
        search: (prev) => ({ ...prev, settings, settingsPage }),
        replace: true
      }),
    [navigate]
  )

  return {
    section,
    page,
    open: useCallback((s: SettingsSection = 'general', p?: SettingsPage) => go(s, p), [go]),
    close: useCallback(() => go(undefined, undefined), [go])
  }
}
