import { Outlet, createRootRoute } from '@tanstack/react-router'
import { AppSidebar } from '@/components/app-sidebar'
import { NotificationCenter } from '@/components/notification-center'
import { Onboarding } from '@/components/onboarding-dialog'
import { RuleSuggestionsHost } from '@/components/rule-suggestions-host'
import { UndoShortcuts } from '@/components/undo-shortcuts'
import { WindowControls } from '@/components/window-controls'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { NotificationsProvider } from '@/lib/notify-store'
import { SuggestionsUiProvider } from '@/lib/suggestions-ui'
import { useSettings } from '@/lib/settings'

export const Route = createRootRoute({
  component: RootComponent
})

function RootComponent() {
  const { settings, setSetting } = useSettings()

  return (
    <NotificationsProvider>
      <SuggestionsUiProvider>
        <SidebarProvider
          open={settings.sidebarOpen}
          onOpenChange={(open) => setSetting('sidebarOpen', open)}
        >
          <AppSidebar />
          <SidebarInset className="h-svh overflow-hidden">
            <header className="relative flex h-12 shrink-0 items-center gap-2 border-b bg-background px-4 [-webkit-app-region:drag]">
              <SidebarTrigger size="icon" className="-ml-1 [-webkit-app-region:no-drag]" />
              <div className="flex [-webkit-app-region:no-drag]">
                <NotificationCenter />
              </div>
              <div className="ml-auto flex items-center gap-1">
                <WindowControls />
              </div>
            </header>
            <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <Outlet />
            </main>
          </SidebarInset>
          <UndoShortcuts />
          <RuleSuggestionsHost />
          <Onboarding />
          <Toaster position="bottom-right" />
        </SidebarProvider>
      </SuggestionsUiProvider>
    </NotificationsProvider>
  )
}
