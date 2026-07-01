import { Outlet, createRootRoute, Link, useMatchRoute } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { HugeiconsIcon } from '@hugeicons/react'
import { Home01Icon, Moon02Icon, StickyNote01Icon, Sun02Icon } from '@hugeicons/core-free-icons'
import { useTheme } from '@/lib/theme'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger
} from '@/components/ui/sidebar'

export const Route = createRootRoute({
  component: RootComponent
})

const NAV_ITEMS = [
  { to: '/', label: 'Home', fuzzy: false, icon: Home01Icon },
  { to: '/notes', label: 'Notes', fuzzy: true, icon: StickyNote01Icon }
] as const

function RootComponent() {
  const matchRoute = useMatchRoute()

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <h1 className="truncate px-2 text-lg font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
            shmoney
          </h1>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV_ITEMS.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      asChild
                      isActive={!!matchRoute({ to: item.to, fuzzy: item.fuzzy })}
                      tooltip={item.label}
                    >
                      <Link to={item.to}>
                        <HugeiconsIcon icon={item.icon} size={16} />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <ThemeToggle />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
        </header>
        <div className="flex-1 overflow-auto p-8">
          <Outlet />
        </div>
      </SidebarInset>
      {import.meta.env.DEV && <TanStackRouterDevtools position="bottom-right" />}
    </SidebarProvider>
  )
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const isDark = theme === 'dark'

  return (
    <SidebarMenuButton
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      tooltip={isDark ? 'Light mode' : 'Dark mode'}
    >
      <HugeiconsIcon icon={isDark ? Sun02Icon : Moon02Icon} size={16} />
      <span>{isDark ? 'Light mode' : 'Dark mode'}</span>
    </SidebarMenuButton>
  )
}
