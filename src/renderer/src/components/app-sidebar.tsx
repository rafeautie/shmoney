import type { ComponentProps } from 'react'
import { Link, useMatchRoute } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Moon02Icon,
  Settings01Icon,
  Sun02Icon,
  ViewIcon,
  ViewOffIcon
} from '@hugeicons/core-free-icons'
import { usePrivacy, useTheme } from '@/lib/settings'
import { Logo } from '@/components/logo'
import { NavChat } from '@/components/nav-chat'
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
            <SidebarMenuButton size="lg" render={<div />}>
              <Logo />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">shmoney</span>
                <span className="truncate text-xs">A personal shmoney app</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain />
        <NavChat />
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <PrivacyToggle />
          </SidebarMenuItem>
          <SidebarMenuItem>
            <ThemeToggle />
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SettingsLink />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

function SettingsLink() {
  const matchRoute = useMatchRoute()

  return (
    <SidebarMenuButton
      render={<Link to="/settings" />}
      isActive={!!matchRoute({ to: '/settings', fuzzy: false })}
      tooltip="Settings"
    >
      <HugeiconsIcon icon={Settings01Icon} size={16} />
      <span>Settings</span>
    </SidebarMenuButton>
  )
}

function PrivacyToggle() {
  const { blurAmounts, setBlurAmounts } = usePrivacy()

  return (
    <SidebarMenuButton
      onClick={() => setBlurAmounts(!blurAmounts)}
      tooltip={blurAmounts ? 'Show amounts' : 'Blur amounts'}
    >
      <HugeiconsIcon icon={blurAmounts ? ViewIcon : ViewOffIcon} size={16} />
      <span>{blurAmounts ? 'Show amounts' : 'Blur amounts'}</span>
    </SidebarMenuButton>
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
