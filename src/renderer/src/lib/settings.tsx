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
    const root = document.documentElement
    // Suppress color transitions for the flip so every component repaints in one
    // instant step instead of fading at its own duration (see .theme-changing).
    root.classList.add('theme-changing')
    root.classList.toggle('dark', settings.theme === 'dark')
    // Force a synchronous reflow so the new colors commit with transitions off,
    // then restore transitions on the next frame.
    void root.offsetHeight
    const id = requestAnimationFrame(() => root.classList.remove('theme-changing'))
    return () => cancelAnimationFrame(id)
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

export function useDetectTransfers() {
  const { settings, setSetting } = useSettings()
  return {
    detectTransfers: settings.detectTransfers,
    setDetectTransfers: useCallback(
      (on: boolean) => setSetting('detectTransfers', on),
      [setSetting]
    )
  }
}

export function useApplyRulesOnSync() {
  const { settings, setSetting } = useSettings()
  return {
    applyRulesOnSync: settings.applyRulesOnSync,
    setApplyRulesOnSync: useCallback(
      (on: boolean) => setSetting('applyRulesOnSync', on),
      [setSetting]
    )
  }
}

export function useRuleSuggestionsEnabled() {
  const { settings, setSetting } = useSettings()
  return {
    ruleSuggestionsEnabled: settings.ruleSuggestionsEnabled,
    setRuleSuggestionsEnabled: useCallback(
      (on: boolean) => setSetting('ruleSuggestionsEnabled', on),
      [setSetting]
    )
  }
}

export function useOnboarding() {
  const { settings, setSetting } = useSettings()
  return {
    onboardingComplete: settings.onboardingComplete,
    completeOnboarding: useCallback(() => setSetting('onboardingComplete', true), [setSetting]),
    // re-run the first-run walkthrough (offered on the Settings page)
    resetOnboarding: useCallback(() => setSetting('onboardingComplete', false), [setSetting])
  }
}
