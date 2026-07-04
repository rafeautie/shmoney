import { Outlet, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { AppSidebar } from '@/components/app-sidebar'
import { WindowControls } from '@/components/window-controls'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { useSettings } from '@/lib/settings'

export const Route = createRootRoute({
  component: RootComponent
})

function RootComponent() {
  const { settings, setSetting } = useSettings()

  return (
    <SidebarProvider
      open={settings.sidebarOpen}
      onOpenChange={(open) => setSetting('sidebarOpen', open)}
    >
      <AppSidebar />
      <SidebarInset className="h-svh overflow-hidden">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-4 [-webkit-app-region:drag]">
          <SidebarTrigger className="-ml-1 [-webkit-app-region:no-drag]" />
          <div className="ml-auto">
            <WindowControls />
          </div>
        </header>
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Outlet />
        </main>
      </SidebarInset>
      {import.meta.env.DEV && <TanStackRouterDevtools position="bottom-right" />}
    </SidebarProvider>
  )
}
