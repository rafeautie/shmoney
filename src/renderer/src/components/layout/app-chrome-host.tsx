import { useEffect } from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'

const APP_NAME = 'shmoney'

// first segment of the path → what alt-tab and the taskbar hover preview show
const PAGE_TITLES: Record<string, string> = {
  accounts: 'Accounts',
  budget: 'Budget',
  reports: 'Reports',
  activity: 'Activity',
  chat: 'Chat',
  settings: 'Settings',
  debug: 'Debug'
}

/**
 * Mounted once at the root. Keeps the window title tracking the current page,
 * and answers navigation requests from the main process (the macOS app menu's
 * Settings item).
 */
export function AppChromeHost(): null {
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (state) => state.location.pathname })

  useEffect(() => {
    const page = PAGE_TITLES[pathname.split('/')[1] ?? '']
    document.title = page ? `${page} · ${APP_NAME}` : APP_NAME
  }, [pathname])

  useEffect(() => window.api.app.onNavigate((to) => navigate({ to })), [navigate])

  return null
}
