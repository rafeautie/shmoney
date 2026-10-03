import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { format } from 'date-fns'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import {
  Activity01Icon,
  Add01Icon,
  AiMagicIcon,
  Analytics01Icon,
  BubbleChatIcon,
  FileImportIcon,
  Invoice01Icon,
  Moon02Icon,
  PiggyBankIcon,
  RefreshIcon,
  Search01Icon,
  Sun03Icon,
  Target02Icon,
  ViewIcon,
  ViewOffIcon,
  Wallet01Icon
} from '@hugeicons/core-free-icons'
import { DEFAULT_TRANSACTION_FILTERS, resolveTransactionFilters } from '@shared/transaction-filters'
import { Amount } from '@/components/amount'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { useConnectSimpleFin } from '@/hooks/use-connect-simplefin'
import { useConversations } from '@/lib/chat'
import { useImportUi } from '@/lib/import-ui'
import { useAutoCategorize, useLlmReady } from '@/lib/llm'
import { isMac } from '@/lib/platform'
import { accountsOptions, connectionOptions, reportsOptions } from '@/lib/queries'
import { usePrivacy, useTheme } from '@/lib/settings'
import { SETTINGS_NAV, useSettingsDialog } from '@/lib/settings-dialog'
import { isDialogOpen, isTypingTarget, startOfTodayEpoch } from '@/lib/utils'

const PAGES = [
  { label: 'Accounts', icon: Wallet01Icon, to: '/accounts' },
  { label: 'All transactions', icon: Invoice01Icon, to: '/accounts', tab: 'transactions' },
  { label: 'Budget', icon: PiggyBankIcon, to: '/budget' },
  { label: 'Goals', icon: Target02Icon, to: '/goals' },
  { label: 'Reports', icon: Analytics01Icon, to: '/reports' },
  { label: 'Activity', icon: Activity01Icon, to: '/activity' },
  { label: 'New chat', icon: BubbleChatIcon, to: '/chat' }
] as const

const RESULT_LIMIT = 6

// Every typed word must appear in the label or keywords; matches at a word start
// rank first. Item values are unique ids, so they are left out of matching.
function filterByKeywords(_value: string, search: string, keywords: string[] = []): number {
  const text = keywords.join(' ').toLowerCase()
  const words = search.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.every((word) => text.includes(word))) return 0
  return words.every((word) => text.startsWith(word) || text.includes(` ${word}`)) ? 1 : 0.5
}

/**
 * Ctrl/Cmd+K palette mounted once at the root. Actions run after the palette has
 * finished closing, so one that opens a dialog never stacks over it.
 */
export function CommandPaletteHost(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const pending = useRef<(() => void) | null>(null)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return
      if (event.key.toLowerCase() !== 'k') return
      if (open) {
        event.preventDefault()
        setOpen(false)
        return
      }
      if (isTypingTarget(event.target) || isDialogOpen()) return
      event.preventDefault()
      setOpen(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  // the action hooks live here, not in the palette body, so a mutation started
  // from the palette keeps its handlers after the body unmounts
  const actions = usePaletteActions()

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(isOpen) => {
        if (isOpen) return
        const run = pending.current
        pending.current = null
        run?.()
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="top-[18%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <CommandPalette
          actions={actions}
          run={(fn) => {
            pending.current = fn
            setOpen(false)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

function usePaletteActions() {
  const navigate = useNavigate()
  const settings = useSettingsDialog()
  const { setOpen: setImportOpen } = useImportUi()
  const { syncConnection } = useConnectSimpleFin()
  const autoCategorize = useAutoCategorize({})
  const llmReady = useLlmReady()
  const { blurAmounts, setBlurAmounts } = usePrivacy()
  const { setTheme } = useTheme()
  return {
    navigate,
    openSettings: settings.open,
    openImport: () => setImportOpen(true),
    sync: () => syncConnection.mutate(),
    syncing: syncConnection.isPending,
    categorize: autoCategorize.start,
    canCategorize: llmReady && !autoCategorize.anyRunning,
    blurAmounts,
    toggleBlur: () => setBlurAmounts(!blurAmounts),
    setTheme
  }
}

function CommandPalette({
  actions,
  run
}: {
  actions: ReturnType<typeof usePaletteActions>
  run: (fn: () => void) => void
}) {
  const [query, setQuery] = useState('')
  const term = useDebounced(query.trim(), 200)
  const searching = query.trim().length > 0
  const { navigate } = actions

  const accounts = useQuery(accountsOptions).data ?? []
  const reports = useQuery(reportsOptions).data ?? []
  const conversations = useConversations().data ?? []
  const connection = useQuery(connectionOptions).data
  const dark = document.documentElement.classList.contains('dark')

  const transactions = useQuery({
    queryKey: ['commandPalette', 'transactions', term],
    queryFn: () =>
      window.api.transactions.list({
        page: 0,
        pageSize: RESULT_LIMIT,
        sortBy: 'date',
        sortDir: 'desc',
        filters: resolveTransactionFilters(
          { ...DEFAULT_TRANSACTION_FILTERS, descriptionSearch: [term] },
          startOfTodayEpoch()
        )
      }),
    enabled: term.length >= 2,
    placeholderData: (previous) => previous
  })

  const showTransactions = (search: string) =>
    run(() => void navigate({ to: '/accounts', search: { tab: 'transactions', q: search } }))

  return (
    <Command filter={filterByKeywords} loop className="bg-transparent">
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search pages, actions, and transactions..."
      />
      <CommandList viewPortClassName="max-h-[min(420px,60vh)]">
        <CommandGroup heading="Actions">
          <PaletteItem
            id="action:new-transaction"
            label="New transaction"
            icon={Add01Icon}
            onSelect={() =>
              run(
                () =>
                  void navigate({ to: '/accounts', search: { tab: 'transactions', create: true } })
              )
            }
          />
          <PaletteItem
            id="action:import"
            label="Import"
            keywords={['file', 'csv', 'ofx', 'qif']}
            icon={FileImportIcon}
            onSelect={() => run(actions.openImport)}
          />
          {connection && (
            <PaletteItem
              id="action:sync"
              label={actions.syncing ? 'Syncing…' : 'Sync now'}
              keywords={['simplefin', 'refresh']}
              icon={RefreshIcon}
              disabled={actions.syncing}
              onSelect={() => run(actions.sync)}
            />
          )}
          <PaletteItem
            id="action:categorize"
            label="Auto-categorize"
            icon={AiMagicIcon}
            disabled={!actions.canCategorize}
            onSelect={() => run(actions.categorize)}
          />
          <PaletteItem
            id="action:blur"
            label={actions.blurAmounts ? 'Show amounts' : 'Hide amounts'}
            keywords={['privacy', 'hide']}
            icon={actions.blurAmounts ? ViewIcon : ViewOffIcon}
            onSelect={() => run(actions.toggleBlur)}
          />
          <PaletteItem
            id="action:theme"
            label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
            keywords={['theme', 'appearance', 'mode']}
            icon={dark ? Sun03Icon : Moon02Icon}
            onSelect={() => run(() => actions.setTheme(dark ? 'light' : 'dark'))}
          />
        </CommandGroup>

        <CommandGroup heading="Go to">
          {PAGES.map((page) => (
            <PaletteItem
              key={page.label}
              id={`page:${page.label}`}
              label={page.label}
              icon={page.icon}
              onSelect={() =>
                run(
                  () =>
                    void navigate({
                      to: page.to,
                      search: 'tab' in page ? { tab: page.tab } : {}
                    })
                )
              }
            />
          ))}
        </CommandGroup>

        {/* the long lists wait for a query, so the empty palette stays short */}
        {searching && (
          <>
            <CommandGroup heading="Settings">
              {SETTINGS_NAV.map((section) => (
                <PaletteItem
                  key={section.id}
                  id={`settings:${section.id}`}
                  label={section.label}
                  keywords={['settings']}
                  icon={section.icon}
                  onSelect={() => run(() => actions.openSettings(section.id))}
                />
              ))}
            </CommandGroup>
            <CommandGroup heading="Accounts">
              {accounts.map((account) => (
                <PaletteItem
                  key={account.id}
                  id={`account:${account.id}`}
                  label={account.name}
                  keywords={account.institutionName ? [account.institutionName] : []}
                  icon={Wallet01Icon}
                  onSelect={() =>
                    run(
                      () =>
                        void navigate({
                          to: '/accounts/$accountId',
                          params: { accountId: String(account.id) }
                        })
                    )
                  }
                />
              ))}
            </CommandGroup>
            <CommandGroup heading="Reports">
              {reports.map((report) => (
                <PaletteItem
                  key={report.id}
                  id={`report:${report.id}`}
                  label={report.name}
                  icon={Analytics01Icon}
                  onSelect={() =>
                    run(
                      () =>
                        void navigate({
                          to: '/reports/$reportId',
                          params: { reportId: String(report.id) }
                        })
                    )
                  }
                />
              ))}
            </CommandGroup>
            <CommandGroup heading="Chats">
              {conversations.map((conversation) => (
                <PaletteItem
                  key={conversation.id}
                  id={`chat:${conversation.id}`}
                  label={conversation.title ?? 'Untitled'}
                  icon={BubbleChatIcon}
                  onSelect={() =>
                    run(() => void navigate({ to: '/chat', search: { c: conversation.id } }))
                  }
                />
              ))}
            </CommandGroup>
          </>
        )}

        {/* server-filtered already, so these skip cmdk's own matching */}
        {searching && (
          <CommandGroup heading="Transactions" forceMount>
            <CommandItem
              value="transaction:all"
              forceMount
              onSelect={() => showTransactions(query.trim())}
            >
              <HugeiconsIcon icon={Search01Icon} />
              <span className="min-w-0 truncate">
                Show all transactions matching “{query.trim()}”
              </span>
            </CommandItem>
            {term.length >= 2 &&
              transactions.data?.rows.map((t) => (
                <CommandItem
                  key={t.id}
                  value={`transaction:${t.id}`}
                  forceMount
                  onSelect={() => showTransactions(t.description)}
                >
                  <HugeiconsIcon icon={Invoice01Icon} />
                  <span className="min-w-0 flex-1 truncate">{t.description}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {t.date ? format(new Date(t.date * 1000), 'MMM d, yyyy') : ''}
                  </span>
                  <Amount
                    value={t.amount}
                    currency={t.currency}
                    className="w-24 shrink-0 text-right"
                  />
                </CommandItem>
              ))}
          </CommandGroup>
        )}
      </CommandList>
      <div className="flex items-center gap-4 border-t bg-tray px-3 py-2 text-xs text-muted-foreground">
        <span>
          <Key>↑</Key> <Key>↓</Key> to move
        </span>
        <span>
          <Key>Enter</Key> to open
        </span>
        <span className="ml-auto">
          <Key>{isMac ? '⌘' : 'Ctrl'}</Key> <Key>K</Key> to close
        </span>
      </div>
    </Command>
  )
}

function PaletteItem({
  id,
  label,
  keywords = [],
  icon,
  disabled,
  onSelect
}: {
  id: string
  label: string
  keywords?: string[]
  icon: IconSvgElement
  disabled?: boolean
  onSelect: () => void
}) {
  return (
    <CommandItem value={id} keywords={[label, ...keywords]} disabled={disabled} onSelect={onSelect}>
      <HugeiconsIcon icon={icon} />
      <span className="truncate">{label}</span>
    </CommandItem>
  )
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="lifted inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] px-1 font-sans text-[11px] text-foreground">
      {children}
    </kbd>
  )
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}
