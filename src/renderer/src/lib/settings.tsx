import { useCallback, useLayoutEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { SettingKey, Settings } from '@shared/settings'

export const SETTINGS_QUERY_KEY = ['settings'] as const

export function useSettings() {
  const queryClient = useQueryClient()
  const { data: settings } = useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: () => window.api.settings.getAll(),
    // settings only change through setSetting, which updates the cache itself
    staleTime: Infinity
  })

  const setSetting = useCallback(
    <K extends SettingKey>(key: K, value: Settings[K]) => {
      queryClient.setQueryData<Settings>(SETTINGS_QUERY_KEY, (prev) =>
        prev ? { ...prev, [key]: value } : prev
      )
      void window.api.settings.set(key, value)
    },
    [queryClient]
  )

  // main.tsx seeds the cache before render, so data is always present
  if (!settings) throw new Error('settings cache not seeded; await loadInitialSettings() first')

  return { settings, setSetting }
}

// rendered once at the root; keeps the dark class in sync with the theme setting
export function ThemeSync() {
  const { settings } = useSettings()

  useLayoutEffect(() => {
    document.documentElement.classList.toggle('dark', settings.theme === 'dark')
  }, [settings.theme])

  return null
}

export function useTheme() {
  const { settings, setSetting } = useSettings()
  return {
    theme: settings.theme,
    setTheme: useCallback((theme: Settings['theme']) => setSetting('theme', theme), [setSetting])
  }
}

export function usePrivacy() {
  const { settings, setSetting } = useSettings()
  return {
    blurAmounts: settings.blurAmounts,
    setBlurAmounts: useCallback((blur: boolean) => setSetting('blurAmounts', blur), [setSetting])
  }
}
