import '@fontsource-variable/geist/index.css'
import 'react-grid-layout/css/styles.css'
import './assets/main.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createHashHistory, createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { queryClient } from './lib/query-client'
import { SETTINGS_QUERY_KEY, ThemeSync } from './lib/settings'
import { TooltipProvider } from './components/ui/tooltip'

// Electron loads the production build from a file:// URL, where
// location.pathname is the on-disk path rather than "/". Hash-based
// history keeps routing independent of that, matching how Electron
// (and Tauri) apps are expected to use TanStack Router.
const router = createRouter({ routeTree, history: createHashHistory() })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// settings come from SQLite via IPC; seed the query cache before the first
// render so the initial paint already has the right theme/blur/sidebar state
queryClient.setQueryData(SETTINGS_QUERY_KEY, await window.api.settings.getAll())

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeSync />
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>
  </React.StrictMode>
)
