import { Link, useMatchRoute } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Activity01Icon,
  AiChat02Icon,
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

const BASE_NAV_ITEMS = [
  { to: '/accounts', label: 'Accounts', fuzzy: true, icon: Wallet01Icon },
  { to: '/budget', label: 'Budget', fuzzy: true, icon: PiggyBankIcon },
  { to: '/reports', label: 'Reports', fuzzy: true, icon: Analytics01Icon },
  { to: '/chat', label: 'Chat', fuzzy: false, icon: AiChat02Icon },
  { to: '/activity', label: 'Activity', fuzzy: false, icon: Activity01Icon }
] as const

// The Debug page is developer-only; the /debug route redirects away in production
// too, but hiding the link keeps it out of the shipped UI entirely.
const DEBUG_NAV_ITEM = { to: '/debug', label: 'Debug', fuzzy: false, icon: Bug01Icon } as const

const NAV_ITEMS = import.meta.env.DEV ? [...BASE_NAV_ITEMS, DEBUG_NAV_ITEM] : BASE_NAV_ITEMS

export function NavMain() {
  const matchRoute = useMatchRoute()

  return (
    <SidebarGroup>
      <SidebarMenu>
        {NAV_ITEMS.map((item) => (
          <SidebarMenuItem key={item.to}>
            <SidebarMenuButton
              render={<Link to={item.to} />}
              isActive={!!matchRoute({ to: item.to, fuzzy: item.fuzzy })}
              tooltip={item.label}
            >
              <HugeiconsIcon icon={item.icon} size={16} />
              <span>{item.label}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
