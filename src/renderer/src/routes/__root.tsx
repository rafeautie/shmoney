import { Outlet, createRootRouteWithContext } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { AppChromeHost } from '@/components/layout/app-chrome-host'
import { AppHeader } from '@/components/layout/app-header'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { AutoSyncHost } from '@/components/layout/auto-sync-host'
import { BackgroundNoticesHost } from '@/components/layout/background-notices-host'
import { ImportFileHost } from '@/components/layout/import-file-host'
import { Onboarding } from '@/components/layout/onboarding-dialog'
import { RuleSuggestionsHost } from '@/components/rules/rule-suggestions-host'
import { SettingsDialog } from '@/components/settings/settings-dialog'
import { UndoShortcuts } from '@/components/layout/undo-shortcuts'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { ImportUiProvider } from '@/lib/import-ui'
import { SuggestionsUiProvider } from '@/lib/suggestions-ui'
import { useSettings } from '@/lib/settings'
import { parseSettingsSection, type SettingsSection } from '@/lib/settings-dialog'

// route loaders warm the query cache before their page mounts, so they need the
// same client the components read from
export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  validateSearch: (search: Record<string, unknown>): { settings?: SettingsSection } => ({
    settings: parseSettingsSection(search.settings)
  }),
  component: RootComponent
})

function RootComponent() {
  const { settings, setSetting } = useSettings()

  return (
    <SuggestionsUiProvider>
      <ImportUiProvider>
        <SidebarProvider
          open={settings.sidebarOpen}
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
          <SettingsDialog />
          <ImportFileHost />
          <AppChromeHost />
          <Onboarding />
          <Toaster position="bottom-right" />
        </SidebarProvider>
      </ImportUiProvider>
    </SuggestionsUiProvider>
  )
}
