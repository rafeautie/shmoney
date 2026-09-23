import type { ComponentProps } from 'react'
import { Link, useMatchRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ComputerIcon,
  Moon02Icon,
  Settings01Icon,
  Sun02Icon,
  ViewIcon,
  ViewOffIcon
} from '@hugeicons/core-free-icons'
import { usePrivacy, useTheme } from '@/lib/settings'
import { isMac } from '@/lib/platform'
import { connectionOptions } from '@/lib/queries'
import { Logo } from '@/components/logo'
import { connectionNeedsAttention } from '@shared/ipc'
import { NavChat } from './nav-chat'
import { NavMain } from './nav-main'
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
      {/* on macOS the traffic lights are drawn over this corner; push past them */}
      <SidebarHeader className={isMac ? 'pt-9' : undefined}>
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
  const { data: connection } = useQuery(connectionOptions)
  const needsAttention = connection ? connectionNeedsAttention(connection) : false

  return (
    <SidebarMenuButton
      render={<Link to="/settings" />}
      isActive={!!matchRoute({ to: '/settings', fuzzy: false })}
      tooltip={needsAttention ? 'Settings: SimpleFIN needs your attention' : 'Settings'}
    >
      {/* the dot rides the icon so it stays visible with the sidebar collapsed */}
      <span className="relative flex">
        <HugeiconsIcon icon={Settings01Icon} size={16} />
        {needsAttention && (
          <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-amber-500 ring-2 ring-sidebar" />
        )}
      </span>
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

// the button names what clicking it does, so each entry is keyed by the theme
// it moves away from: light → dark → system → light
const NEXT_THEME = {
  light: { theme: 'dark', label: 'Dark mode', icon: Moon02Icon },
  dark: { theme: 'system', label: 'System theme', icon: ComputerIcon },
  system: { theme: 'light', label: 'Light mode', icon: Sun02Icon }
} as const

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const next = NEXT_THEME[theme]

  return (
    <SidebarMenuButton onClick={() => setTheme(next.theme)} tooltip={next.label}>
      <HugeiconsIcon icon={next.icon} size={16} />
      <span>{next.label}</span>
    </SidebarMenuButton>
  )
}
