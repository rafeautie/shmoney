import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { SettingKey, Settings } from '@shared/settings'
import { startPrivacyTransition } from '@/lib/privacy-transition'

export const SETTINGS_QUERY_KEY = ['settings'] as const

const settingsOptions = {
  queryKey: SETTINGS_QUERY_KEY,
  queryFn: () => window.api.settings.getAll(),
  // setSetting and SettingsChangeSync update the cache themselves
  staleTime: Infinity
}

export function useSetSetting() {
  const queryClient = useQueryClient()
  return useCallback(
    <K extends SettingKey>(key: K, value: Settings[K]): Promise<boolean> => {
      queryClient.setQueryData<Settings>(SETTINGS_QUERY_KEY, (prev) =>
        prev ? { ...prev, [key]: value } : prev
      )
      return window.api.settings.set(key, value)
    },
    [queryClient]
  )
}

/** One setting's value; re-renders only when that key changes. */
export function useSetting<K extends SettingKey>(key: K): Settings[K] {
  const { data } = useQuery({ ...settingsOptions, select: (s: Settings) => s[key] })
  // main.tsx seeds the cache before render, so data is always present
  if (data === undefined)
    throw new Error('settings cache not seeded; await loadInitialSettings() first')
  return data
}

export function useSettings() {
  const { data: settings } = useQuery(settingsOptions)
  const setSetting = useSetSetting()

  if (!settings) throw new Error('settings cache not seeded; await loadInitialSettings() first')

  return { settings, setSetting }
}

// rendered once at the root; main changes a few settings itself (zoom shortcuts)
export function SettingsChangeSync() {
  const queryClient = useQueryClient()
  useEffect(
    () =>
      window.api.settings.onChanged(({ key, value }) =>
        queryClient.setQueryData<Settings>(SETTINGS_QUERY_KEY, (prev) =>
          prev ? { ...prev, [key]: value } : prev
        )
      ),
    [queryClient]
  )
  return null
}

// rendered once at the root; keeps the dark class in sync with the theme setting
export function ThemeSync() {
  const theme = useSetting('theme')
  // main mirrors the theme setting onto nativeTheme.themeSource, so this query
  // already answers for the explicit choices too; subscribing only matters for
  // 'system', where the OS can flip while the app is running
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  )

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent): void => setSystemDark(e.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const dark = theme === 'system' ? systemDark : theme === 'dark'

  useLayoutEffect(() => {
    const root = document.documentElement
    // Suppress transitions for the theme swap, which recolors many elements at
    // once, so it repaints in one instant step instead of each fading at its
    // own duration (see .suppress-transitions). The blur-amounts toggle is left
    // out on purpose: its figures animate (see privacy-transition).
    root.classList.add('suppress-transitions')
    root.classList.toggle('dark', dark)
    // Force a synchronous reflow so the new styles commit with transitions off,
    // then restore transitions on the next frame.
    void root.offsetHeight
    const id = requestAnimationFrame(() => root.classList.remove('suppress-transitions'))
    return () => cancelAnimationFrame(id)
  }, [dark])

  return null
}

export function useTheme() {
  const setSetting = useSetSetting()
  return {
    theme: useSetting('theme'),
    setTheme: useCallback((theme: Settings['theme']) => setSetting('theme', theme), [setSetting])
  }
}

export function usePrivacy() {
  const setSetting = useSetSetting()
  return {
    blurAmounts: useSetting('blurAmounts'),
    setBlurAmounts: useCallback(
      (blur: boolean) => {
        startPrivacyTransition()
        setSetting('blurAmounts', blur)
      },
      [setSetting]
    )
  }
}

export function useNativeNotifications() {
  const { settings, setSetting } = useSettings()
  return {
    nativeNotifications: settings.nativeNotifications,
    setNativeNotifications: useCallback(
      (on: boolean) => setSetting('nativeNotifications', on),
      [setSetting]
    )
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
  const queryClient = useQueryClient()
  return {
    ruleSuggestionsEnabled: settings.ruleSuggestionsEnabled,
    // the suggestion list follows the setting in main, so refetch once it's stored
    setRuleSuggestionsEnabled: useCallback(
      (on: boolean) =>
        void setSetting('ruleSuggestionsEnabled', on).then(() =>
          queryClient.invalidateQueries({ queryKey: ['ruleSuggestions'] })
        ),
      [setSetting, queryClient]
    )
  }
}

export function useGoalsView() {
  const { settings, setSetting } = useSettings()
  return {
    goalsView: settings.goalsView,
    setGoalsView: useCallback(
      (view: Settings['goalsView']) => setSetting('goalsView', view),
      [setSetting]
    )
  }
}

export function useBudgetView() {
  const { settings, setSetting } = useSettings()
  return {
    budgetView: settings.budgetView,
    setBudgetView: useCallback(
      (view: Settings['budgetView']) => setSetting('budgetView', view),
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
