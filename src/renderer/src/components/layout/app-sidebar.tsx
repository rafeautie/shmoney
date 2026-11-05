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
    <Sidebar collapsible="icon" className={isMac ? MAC_RAIL : undefined} {...props}>
      {isMac && <TrafficLightStrip />}
      {/* on macOS the traffic lights are drawn over this corner; start the logo
          where the title bar ends. Only while expanded: collapsed, the rail
          already starts below the title bar, and SidebarHeader's own padding
          (which outranks a plain pt-*) takes over */}
      <SidebarHeader className={isMac ? 'pt-12' : undefined}>
        {/* a plain row, not a menu button: it does nothing, so no hover fill or
            button padding. Collapsed, the rail's width clips it to the logo */}
        <div className="flex items-center gap-[9px] overflow-hidden">
          <Logo />
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-medium">shmoney</span>
            <span className="truncate text-xs">A personal shmoney app</span>
          </div>
        </div>
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
      <SidebarRail className={isMac ? MAC_RAIL_EDGE : undefined} />
    </Sidebar>
  )
}

/**
 * The traffic lights span ~16-68px, wider than the 48px icon rail, so collapsed
 * they would straddle the rail's edge. Instead the collapsed rail drops below
 * the 3rem title bar and reads as a panel tucked under it: a top border that
 * meets the right one in a rounded corner. The top moves with the collapse so
 * the rail slides into place rather than jumping. The inner fill is rounded
 * 1px tighter than the border so no sliver shows between them.
 */
const MAC_RAIL = [
  'transition-[left,right,width,top]',
  // height comes from top and bottom in both states, so the bottom edge stays
  // pinned while top animates; a fixed h-svh would push the footer off the
  // window and slide it back up on every expand
  'h-auto group-data-[collapsible=icon]:top-12',
  'group-data-[collapsible=icon]:rounded-tr-xl group-data-[collapsible=icon]:border-t',
  '*:data-[slot=sidebar-inner]:group-data-[collapsible=icon]:rounded-tr-[calc(var(--radius-xl)-1px)]'
].join(' ')

/**
 * The rail's hover line is a straight 2px stroke over the right border (the
 * border plus 1px outside it), which would cut across the collapsed rail's
 * rounded corner. Collapsed, it traces the rail's whole outline instead: the
 * same right stroke curving into the top border and running along it to the
 * window's left edge, 1px outside the rail's own radius so the two stay
 * concentric. The box spans the rail, so it takes no pointer events; the
 * rail's own hit area is unchanged.
 */
const MAC_RAIL_EDGE = [
  'group-data-[collapsible=icon]:after:pointer-events-none',
  'group-data-[collapsible=icon]:after:start-auto group-data-[collapsible=icon]:after:right-1.5',
  'group-data-[collapsible=icon]:after:-top-0.5 group-data-[collapsible=icon]:after:w-[calc(var(--sidebar-width-icon)+1px)]',
  'group-data-[collapsible=icon]:after:rounded-tr-[calc(var(--radius-xl)+1px)]',
  'group-data-[collapsible=icon]:after:border-t-2 group-data-[collapsible=icon]:after:border-r-2 group-data-[collapsible=icon]:after:border-transparent',
  'group-data-[collapsible=icon]:hover:after:bg-transparent group-data-[collapsible=icon]:hover:after:border-sidebar-border'
].join(' ')

/**
 * What the rail leaves above it is more title bar (the frame behind it carries
 * the canvas tone, see main.css), so make it draggable like the rest of the bar.
 */
function TrafficLightStrip() {
  return (
    <div
      aria-hidden
      className="fixed top-0 left-0 hidden h-12 w-(--sidebar-width-icon) [-webkit-app-region:drag] group-data-[collapsible=icon]:block"
    />
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
      // hidden figures ripple out from here, see privacy-transition
      data-privacy-toggle
      onClick={() => setBlurAmounts(!blurAmounts)}
      tooltip={blurAmounts ? 'Show Amounts' : 'Hide Amounts'}
    >
      <HugeiconsIcon icon={blurAmounts ? ViewIcon : ViewOffIcon} size={16} />
      <span>{blurAmounts ? 'Show Amounts' : 'Hide Amounts'}</span>
    </SidebarMenuButton>
  )
}
