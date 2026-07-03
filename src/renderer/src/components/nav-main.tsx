import { Link, useMatchRoute } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Analytics01Icon,
  Home01Icon,
  Settings01Icon,
  Wallet01Icon
} from '@hugeicons/core-free-icons'
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem
} from '@/components/ui/sidebar'

const NAV_ITEMS = [
  { to: '/', label: 'Home', fuzzy: false, icon: Home01Icon },
  { to: '/accounts', label: 'Accounts', fuzzy: true, icon: Wallet01Icon },
  { to: '/reports', label: 'Reports', fuzzy: true, icon: Analytics01Icon },
  { to: '/settings', label: 'Settings', fuzzy: false, icon: Settings01Icon }
] as const

export function NavMain() {
  const matchRoute = useMatchRoute()

  return (
    <SidebarGroup>
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
    </SidebarGroup>
  )
}
