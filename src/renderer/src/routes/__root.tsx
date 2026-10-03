import { Suspense, lazy, useState } from 'react'
import { Outlet, createRootRouteWithContext } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { AppChromeHost } from '@/components/layout/app-chrome-host'
import { AppHeader } from '@/components/layout/app-header'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { AutoSyncHost } from '@/components/layout/auto-sync-host'
import { BackgroundNoticesHost } from '@/components/layout/background-notices-host'
import { ImportFileHost } from '@/components/layout/import-file-host'
import { RuleSuggestionsHost } from '@/components/rules/rule-suggestions-host'
import { UndoShortcuts } from '@/components/layout/undo-shortcuts'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { ImportUiProvider } from '@/lib/import-ui'
import { SuggestionsUiProvider } from '@/lib/suggestions-ui'
import { useSetSetting, useSetting } from '@/lib/settings'
import {
  parseSettingsPage,
  parseSettingsSection,
  useSettingsDialog,
  type SettingsPage,
  type SettingsSection
} from '@/lib/settings-dialog'

// both pull heavy dependencies (charts, license data, the model picker) that most
// launches never need, so they load on demand
const SettingsDialog = lazy(() =>
  import('@/components/settings/settings-dialog').then((m) => ({ default: m.SettingsDialog }))
)
const Onboarding = lazy(() =>
  import('@/components/layout/onboarding-dialog').then((m) => ({ default: m.Onboarding }))
)

// mounts the dialog on first open, then keeps it so its close animation plays
function LazySettingsDialog() {
  const { section } = useSettingsDialog()
  const [opened, setOpened] = useState(false)
  if (section && !opened) setOpened(true)
  if (!opened) return null
  return (
    <Suspense fallback={null}>
      <SettingsDialog />
    </Suspense>
  )
}

function LazyOnboarding() {
  const onboardingComplete = useSetting('onboardingComplete')
  if (onboardingComplete) return null
  return (
    <Suspense fallback={null}>
      <Onboarding />
    </Suspense>
  )
}

// route loaders warm the query cache before their page mounts, so they need the
// same client the components read from
export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  validateSearch: (
    search: Record<string, unknown>
  ): { settings?: SettingsSection; settingsPage?: SettingsPage } => ({
    settings: parseSettingsSection(search.settings),
    settingsPage: parseSettingsPage(search.settingsPage)
  }),
  component: RootComponent
})

function RootComponent() {
  const sidebarOpen = useSetting('sidebarOpen')
  const setSetting = useSetSetting()

  return (
    <SuggestionsUiProvider>
      <ImportUiProvider>
        <SidebarProvider
          open={sidebarOpen}
          onOpenChange={(open) => setSetting('sidebarOpen', open)}
        >
          <AppSidebar />
          <SidebarInset className="h-svh overflow-hidden">
            <AppHeader />
            <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <Outlet />
            </main>
          </SidebarInset>
          <UndoShortcuts />
          <AutoSyncHost />
          <BackgroundNoticesHost />
          <RuleSuggestionsHost />
          <LazySettingsDialog />
          <ImportFileHost />
          <AppChromeHost />
          <LazyOnboarding />
          <Toaster position="bottom-right" />
        </SidebarProvider>
      </ImportUiProvider>
    </SuggestionsUiProvider>
  )
}
