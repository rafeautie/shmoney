import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import type { Settings } from '@shared/settings'
import { queryClient } from '@renderer/lib/query-client'
import { clearData, seedDataset } from '@renderer/lib/demo'
import { DatasetControls } from '@renderer/components/demo/dataset-controls'
import { SCREENS } from './screens'

// How a host page configures and drives the demo. The screen is the URL hash
// (the app's own hash router), or a named screen from screens.ts; everything
// else rides in the query string:
//
//   ?screen=budget                    open a named screen (see screens.ts)
//   &dataset=household|starter|none   data loaded on boot (default household)
//   &theme=light|dark|system          overrides the stored theme
//   &sidebar=open|collapsed
//   &bar=0                            hide the demo bar (the host draws its own)
//   &shot=1                           render exactly like the desktop app
//
// A host on an allowed origin can also postMessage
//   { type: 'shmoney-demo', action: 'navigate', screen: 'budget' }  (or to: '/budget')
//   { type: 'shmoney-demo', action: 'seed', dataset: 'starter' }
//   { type: 'shmoney-demo', action: 'clear' }
//   { type: 'shmoney-demo', action: 'theme', theme: 'light' }
// and hears back { type: 'shmoney-demo', event: 'ready' | 'route', route }.

export interface EmbedConfig {
  /** hash route of the ?screen= named screen, when one was given */
  route: string | null
  dataset: string | null
  theme: Settings['theme'] | null
  sidebar: 'open' | 'collapsed' | null
  bar: boolean
  shot: boolean
}

const THEMES = ['light', 'dark', 'system'] as const

function allowedOrigin(origin: string): boolean {
  try {
    const { protocol, hostname } = new URL(origin)
    if (hostname === 'localhost' || hostname === '127.0.0.1') return true
    return protocol === 'https:' && (hostname === 'rafe.dev' || hostname.endsWith('.rafe.dev'))
  } catch {
    return false
  }
}

const route = (): string => location.hash.replace(/^#/, '') || '/'

function screenRoute(name: unknown): string | null {
  return SCREENS.find((s) => s.name === name)?.route ?? null
}

export function readEmbedConfig(): EmbedConfig {
  const params = new URLSearchParams(location.search)
  const dataset = params.get('dataset') ?? 'household'
  const theme = params.get('theme')
  const sidebar = params.get('sidebar')
  return {
    route: screenRoute(params.get('screen')),
    dataset: dataset === 'none' ? null : dataset,
    theme: THEMES.find((t) => t === theme) ?? null,
    sidebar: sidebar === 'open' || sidebar === 'collapsed' ? sidebar : null,
    bar: params.get('bar') !== '0' && params.get('shot') !== '1',
    shot: params.get('shot') === '1'
  }
}

/** Runs before the renderer boots, so its first paint already has the data. */
export async function applyEmbedConfig(config: EmbedConfig): Promise<void> {
  // The router's hash history appends location.search to the hash route, which
  // would garble routes with their own query (#/chat?c=2), so the embed
  // parameters leave the URL once read. Screenshot mode stays visible to the
  // renderer as a data attribute.
  history.replaceState(null, '', `${location.pathname}#${config.route ?? route()}`)
  if (config.shot) document.documentElement.dataset.shot = ''
  if (config.dataset) await window.api.demo.seed(config.dataset)
  if (config.theme) await window.api.settings.set('theme', config.theme)
  if (config.sidebar) await window.api.settings.set('sidebarOpen', config.sidebar === 'open')
}

async function setTheme(theme: Settings['theme']): Promise<void> {
  await window.api.settings.set('theme', theme)
  await queryClient.invalidateQueries({ queryKey: ['settings'] })
}

function DemoBar(): React.JSX.Element {
  return (
    // the header's right end is empty in the app (the desktop window's caption
    // buttons sit there), so the bar never covers app controls
    <div className="fixed top-2.5 right-3 z-50 flex items-center gap-2.5 text-xs text-muted-foreground">
      <span className="whitespace-nowrap">Sample data</span>
      <DatasetControls />
    </div>
  )
}

export function startEmbedBridge(config: EmbedConfig): void {
  if (config.bar) {
    const host = document.createElement('div')
    document.body.append(host)
    createRoot(host).render(
      <QueryClientProvider client={queryClient}>
        <DemoBar />
      </QueryClientProvider>
    )
  }

  const parentOrigin = document.referrer ? new URL(document.referrer).origin : null
  const post = (message: Record<string, unknown>): void => {
    if (window.parent === window || !parentOrigin || !allowedOrigin(parentOrigin)) return
    window.parent.postMessage({ type: 'shmoney-demo', ...message }, parentOrigin)
  }
  window.addEventListener('message', (e: MessageEvent) => {
    if (!allowedOrigin(e.origin) || e.data?.type !== 'shmoney-demo') return
    const data = e.data as {
      action?: string
      to?: string
      screen?: string
      dataset?: string
      theme?: string
    }
    const to = screenRoute(data.screen) ?? (typeof data.to === 'string' ? data.to : null)
    if (data.action === 'navigate' && to) location.hash = to
    else if (data.action === 'seed' && typeof data.dataset === 'string')
      void seedDataset(data.dataset)
    else if (data.action === 'clear') void clearData()
    else if (data.action === 'theme') {
      const theme = THEMES.find((t) => t === data.theme)
      if (theme) void setTheme(theme)
    }
  })
  window.addEventListener('hashchange', () => post({ event: 'route', route: route() }))
  post({ event: 'ready', route: route() })
}
