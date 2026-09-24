import type { ComponentProps } from 'react'
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
import { Logo } from '@/components/logo'
import { NavChat } from './nav-chat'
import { NavLinkButton, NavMain } from './nav-main'
import { useSettingsStatus } from '@/lib/nav-status'
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
  return (
    <NavLinkButton
      to="/settings"
      label="Settings"
      fuzzy={false}
      icon={Settings01Icon}
      status={useSettingsStatus()}
    />
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
