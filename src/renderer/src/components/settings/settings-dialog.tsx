import { useEffect, useRef } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { StatusDot } from '@/components/layout/nav-dot'
import { useSettingsSectionStatuses } from '@/lib/nav-status'
import { SETTINGS_NAV, useSettingsDialog, type SettingsSection } from '@/lib/settings-dialog'
import { isDemo } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { AboutSettings } from './about-settings'
import { AppearanceSettings } from './appearance-settings'
import { CategoriesSettings } from './categories-settings'
import { ConnectionSettings } from './connection-settings'
import { LlmSettings } from './llm-settings'
import { LlmUsageSettings } from './llm-usage-settings'
import { NotificationSettings } from './notification-settings'
import { PrivacySettings } from './privacy-settings'
import { RulesSettings } from './rules-settings'
import { StorageSettings } from './storage-settings'
import { TransferSettings } from './transfer-settings'

const CONTENT: Record<SettingsSection, () => React.JSX.Element> = {
  general: () => (
    <>
      <AppearanceSettings />
      <PrivacySettings />
      {/* OS notifications have no counterpart in a browser tab */}
      {!isDemo && <NotificationSettings />}
    </>
  ),
  connection: () => <ConnectionSettings />,
  categories: () => (
    <>
      <CategoriesSettings />
      <TransferSettings />
    </>
  ),
  rules: () => <RulesSettings />,
  ai: () => <LlmSettings />,
  'ai-usage': () => <LlmUsageSettings />,
  storage: () => <StorageSettings />,
  about: () => <AboutSettings />
}

/**
 * Globally mounted settings dialog: a section list on the left, the chosen
 * section on the right. Open state is the ?settings= search param (see
 * useSettingsDialog), so it opens over whatever page is showing.
 */
export function SettingsDialog(): React.JSX.Element {
  const { section, page, open, close } = useSettingsDialog()
  const statuses = useSettingsSectionStatuses()
  const active = SETTINGS_NAV.find((s) => s.id === section) ?? SETTINGS_NAV[0]
  const activeRef = useRef<HTMLButtonElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    viewportRef.current?.scrollTo({ top: 0 })
  }, [page])

  return (
    <Dialog
      open={section !== undefined}
      onOpenChange={(next, details) => {
        if (next) return
        if (details.reason === 'escape-key') {
          // an inline editor that used Escape to cancel prevents its default
          if (details.event.defaultPrevented) return
          // on a sub-page, Escape steps back to its section first
          if (page) return open(active.id)
        }
        close()
      }}
    >
      <DialogContent
        className="flex h-[min(720px,calc(100vh-4rem))] gap-0 overflow-hidden p-0 sm:max-w-4xl"
        // base-ui otherwise focuses the first section, even when opened at another
        initialFocus={activeRef}
      >
        <nav className="flex w-48 shrink-0 flex-col gap-0.5 border-r bg-muted/40 px-2.5 py-4.5">
          <DialogTitle className="px-2 pb-2.5">Settings</DialogTitle>
          {SETTINGS_NAV.map(({ id, label, icon }) => {
            const status = statuses[id]
            return (
              <button
                key={id}
                ref={id === active.id ? activeRef : undefined}
                type="button"
                aria-current={id === active.id ? 'page' : undefined}
                title={status?.tooltip}
                onClick={() => open(id)}
                className={cn(
                  'flex h-8 items-center gap-[9px] rounded-[6px] px-2 py-1.5 text-left text-xs outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/50',
                  id === active.id && 'bg-sidebar-accent'
                )}
              >
                <HugeiconsIcon icon={icon} size={16} />
                <span className="flex-1 truncate">{label}</span>
                {status && <StatusDot tone={status.tone} />}
              </button>
            )
          })}
        </nav>
        {/* keyed so switching sections starts at the top; sub-pages scroll back
            up without a remount, so a section keeps its state across them */}
        <ScrollArea key={active.id} viewportRef={viewportRef} className="min-h-0 min-w-0 flex-1">
          <div className="space-y-8 p-6 pr-12">{CONTENT[active.id]()}</div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
