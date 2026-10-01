import type { ComponentProps } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Settings01Icon, ViewIcon, ViewOffIcon } from '@hugeicons/core-free-icons'
import { usePrivacy } from '@/lib/settings'
import { isMac } from '@/lib/platform'
import { Logo } from '@/components/logo'
import { NavChat } from './nav-chat'
import { NavMain } from './nav-main'
import { NavDot } from './nav-dot'
import { useSettingsStatus } from '@/lib/nav-status'
import { useSettingsDialog } from '@/lib/settings-dialog'
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
            <SettingsButton />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

function SettingsButton() {
  const { section, open } = useSettingsDialog()
  const status = useSettingsStatus()
  return (
    <SidebarMenuButton
      onClick={() => open()}
      isActive={section !== undefined}
      tooltip={status ? `Settings: ${status.tooltip}` : 'Settings'}
    >
      <span className="relative flex">
        <HugeiconsIcon icon={Settings01Icon} size={16} />
        {status && <NavDot tone={status.tone} />}
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
