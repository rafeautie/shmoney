import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import {
  AiBrain01Icon,
  BankIcon,
  DatabaseIcon,
  InformationCircleIcon,
  Settings01Icon,
  Tag01Icon,
  WorkflowSquare03Icon
} from '@hugeicons/core-free-icons'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { StatusDot } from '@/components/layout/nav-dot'
import { useSettingsSectionStatuses } from '@/lib/nav-status'
import { useSettingsDialog, type SettingsSection } from '@/lib/settings-dialog'
import { isDemo } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { AboutSettings } from './about-settings'
import { AppearanceSettings } from './appearance-settings'
import { CategoriesSettings } from './categories-settings'
import { ConnectionSettings } from './connection-settings'
import { LlmSettings } from './llm-settings'
import { NotificationSettings } from './notification-settings'
import { PrivacySettings } from './privacy-settings'
import { RulesSettings } from './rules-settings'
import { StorageSettings } from './storage-settings'
import { TransferSettings } from './transfer-settings'

const SECTIONS: {
  id: SettingsSection
  label: string
  icon: IconSvgElement
  content: () => React.JSX.Element
}[] = [
  {
    id: 'general',
    label: 'General',
    icon: Settings01Icon,
    content: () => (
      <>
        <AppearanceSettings />
        <PrivacySettings />
        {/* OS notifications have no counterpart in a browser tab */}
        {!isDemo && <NotificationSettings />}
      </>
    )
  },
  { id: 'connection', label: 'Connection', icon: BankIcon, content: () => <ConnectionSettings /> },
  {
    id: 'categories',
    label: 'Categories',
    icon: Tag01Icon,
    content: () => (
      <>
        <CategoriesSettings />
        <TransferSettings />
      </>
    )
  },
  { id: 'rules', label: 'Rules', icon: WorkflowSquare03Icon, content: () => <RulesSettings /> },
  { id: 'ai', label: 'AI model', icon: AiBrain01Icon, content: () => <LlmSettings /> },
  { id: 'storage', label: 'Storage', icon: DatabaseIcon, content: () => <StorageSettings /> },
  { id: 'about', label: 'About', icon: InformationCircleIcon, content: () => <AboutSettings /> }
]

/**
 * Globally mounted settings dialog: a section list on the left, the chosen
 * section on the right. Open state is the ?settings= search param (see
 * useSettingsDialog), so it opens over whatever page is showing.
 */
export function SettingsDialog(): React.JSX.Element {
  const { section, open, close } = useSettingsDialog()
  const statuses = useSettingsSectionStatuses()
  const active = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0]

  return (
    <Dialog open={section !== undefined} onOpenChange={(next) => !next && close()}>
      <DialogContent
        className="flex h-[min(720px,calc(100vh-4rem))] gap-0 overflow-hidden p-0 sm:max-w-4xl"
        onKeyDown={(event) => {
          // base-ui's escape-to-close does not fire here. Escapes from nested
          // dialogs bubble through the React tree but not the DOM, and inline
          // editors use Escape to cancel, so only close for the popup itself.
          const target = event.target as HTMLElement
          if (
            event.key === 'Escape' &&
            event.currentTarget.contains(target) &&
            !target.closest('input, textarea, [contenteditable=true]')
          ) {
            close()
          }
        }}
      >
        <nav className="flex w-48 shrink-0 flex-col gap-0.5 border-r bg-muted/40 p-2">
          <DialogTitle className="px-2 pt-1 pb-2">Settings</DialogTitle>
          {SECTIONS.map(({ id, label, icon }) => {
            const status = statuses[id]
            return (
              <button
                key={id}
                type="button"
                aria-current={id === active.id ? 'page' : undefined}
                title={status?.tooltip}
                onClick={() => open(id)}
                className={cn(
                  'flex h-8 items-center gap-2 rounded-md px-2 text-left text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50',
                  id === active.id && 'bg-muted font-medium'
                )}
              >
                <HugeiconsIcon icon={icon} size={16} />
                <span className="flex-1 truncate">{label}</span>
                {status && <StatusDot tone={status.tone} />}
              </button>
            )
          })}
        </nav>
        {/* keyed so switching sections starts at the top */}
        <ScrollArea key={active.id} className="min-h-0 min-w-0 flex-1">
          <div className="space-y-8 p-6 pr-12">{active.content()}</div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
