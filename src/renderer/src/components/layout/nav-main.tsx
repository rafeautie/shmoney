import { Link, useMatchRoute } from '@tanstack/react-router'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import {
  Activity01Icon,
  Analytics01Icon,
  Bug01Icon,
  PiggyBankIcon,
  Wallet01Icon
} from '@hugeicons/core-free-icons'
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem
} from '@/components/ui/sidebar'
import { useAccountsStatus, useActivityStatus, type DotStatus } from '@/lib/nav-status'
import { NavDot } from './nav-dot'

// Chat lives in its own sidebar section (NavChat), rendered below this group.
const BASE_NAV_ITEMS = [
  { to: '/accounts', label: 'Accounts', fuzzy: true, icon: Wallet01Icon },
  { to: '/budget', label: 'Budget', fuzzy: true, icon: PiggyBankIcon },
  { to: '/reports', label: 'Reports', fuzzy: true, icon: Analytics01Icon },
  { to: '/activity', label: 'Activity', fuzzy: false, icon: Activity01Icon }
] as const

// The Debug page is developer-only; the /debug route redirects away in production
// too, but hiding the link keeps it out of the shipped UI entirely.
const DEBUG_NAV_ITEM = { to: '/debug', label: 'Debug', fuzzy: false, icon: Bug01Icon } as const

const NAV_ITEMS = import.meta.env.DEV ? [...BASE_NAV_ITEMS, DEBUG_NAV_ITEM] : BASE_NAV_ITEMS

export function NavMain() {
  const statuses: Partial<Record<(typeof NAV_ITEMS)[number]['to'], DotStatus | null>> = {
    '/accounts': useAccountsStatus(),
    '/activity': useActivityStatus()
  }

  return (
    <SidebarGroup>
      <SidebarMenu>
        {NAV_ITEMS.map((item) => (
          <SidebarMenuItem key={item.to}>
            <NavLinkButton {...item} status={statuses[item.to] ?? null} />
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}

/** A sidebar page link whose icon carries the page's status dot; the tooltip says why. */
export function NavLinkButton({
  to,
  label,
  fuzzy,
  icon,
  status
}: {
  to: string
  label: string
  fuzzy: boolean
  icon: IconSvgElement
  status: DotStatus | null
}) {
  const matchRoute = useMatchRoute()
  return (
    <SidebarMenuButton
      render={<Link to={to} />}
      isActive={!!matchRoute({ to, fuzzy })}
      tooltip={status ? `${label}: ${status.tooltip}` : label}
    >
      {/* the dot rides the icon so it stays visible with the sidebar collapsed */}
      <span className="relative flex">
        <HugeiconsIcon icon={icon} size={16} />
        {status && <NavDot tone={status.tone} />}
      </span>
      <span>{label}</span>
    </SidebarMenuButton>
  )
}
