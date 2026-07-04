import type { ComponentProps } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Moon02Icon, Sun02Icon } from '@hugeicons/core-free-icons'
import { useTheme } from '@/lib/settings'
import { Logo } from '@/components/logo'
import { NavMain } from '@/components/nav-main'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail
} from '@/components/ui/sidebar'

export function AppSidebar(props: ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <div>
                <Logo />
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">shmoney</span>
                  <span className="truncate text-xs">A personal shmoney app</span>
                </div>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain />
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <ThemeToggle />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
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
