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

export function parseSettingsSection(value: unknown): SettingsSection | undefined {
  return SETTINGS_SECTIONS.find((s) => s === value)
}

// The settings dialog's open section lives in a root search param
// (?settings=rules) so the macOS menu, in-app links, and demo screenshots can
// open it at a section over whatever page is showing.
export function useSettingsDialog(): {
  section: SettingsSection | undefined
  open: (section?: SettingsSection) => void
  close: () => void
} {
  const navigate = useNavigate()
  const section = useSearch({ strict: false, select: (s) => s.settings })

  const go = useCallback(
    (settings: SettingsSection | undefined) =>
      void navigate({ to: '.', search: (prev) => ({ ...prev, settings }), replace: true }),
    [navigate]
  )

  return {
    section,
    open: useCallback((s: SettingsSection = 'general') => go(s), [go]),
    close: useCallback(() => go(undefined), [go])
  }
}
