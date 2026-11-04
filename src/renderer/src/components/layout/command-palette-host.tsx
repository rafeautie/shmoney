import { useEffect, useEffectEvent, useRef, useState } from 'react'
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
  Cancel01Icon,
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
import { cn, isDialogOpen, isTypingTarget, startOfTodayEpoch } from '@/lib/utils'

const PAGES = [
  { label: 'Accounts', icon: Wallet01Icon, to: '/accounts' },
  { label: 'All Transactions', icon: Invoice01Icon, to: '/accounts', tab: 'transactions' },
  { label: 'Budget', icon: PiggyBankIcon, to: '/budget' },
  { label: 'Goals', icon: Target02Icon, to: '/goals' },
  { label: 'Reports', icon: Analytics01Icon, to: '/reports' },
  { label: 'Activity', icon: Activity01Icon, to: '/activity' },
  { label: 'New Chat', icon: BubbleChatIcon, to: '/chat' }
] as const

const RESULT_LIMIT = 6

// The field is centered on the title bar (see app-header for the --search-*
// lane). When something wide claims one end, it slides toward the other by
// just enough to stay in its lane, rather than shrinking to keep centered.
function searchSize(width: string): React.CSSProperties {
  return {
    width,
    translate: `calc(min(0px, var(--search-full) / 2 - var(--search-right) - ${width} / 2) + max(0px, var(--search-left) - var(--search-full) / 2 + ${width} / 2))`
  }
}
const OPEN_SIZE = searchSize('min(36rem, var(--search-room, calc(100vw - 2rem)))')
const CLOSED_SIZE = searchSize('min(28rem, 40vw, var(--search-room, 40vw))')

// Every typed word must appear in the label or keywords; matches at a word start
// rank first. Item values are unique ids, so they are left out of matching.
function filterByKeywords(_value: string, search: string, keywords: string[] = []): number {
  const text = keywords.join(' ').toLowerCase()
  const words = search.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.every((word) => text.includes(word))) return 0
  return words.every((word) => text.startsWith(word) || text.includes(` ${word}`)) ? 1 : 0.5
}

/**
 * The command palette, pinned to the title bar: the search field is its input
 * and the results drop down beneath it. Opening and closing are always the
 * user's doing: a click, typing or Ctrl/Cmd+K opens it; Escape or a click
 * elsewhere closes it, and so does choosing a result that goes somewhere (a
 * page, a record, Settings). An action that works in place leaves it open; one
 * that opens a dialog takes focus, which closes it, and the dialog handing
 * focus back on close does not reopen it.
 */
export function TitleBarSearch({ className }: { className?: string }): React.JSX.Element {
  const [open, setOpenState] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  // the width is tied to the window, so it eases only while opening or
  // closing; the rest of the time it follows a resize at once
  const [toggling, setToggling] = useState(false)
  const togglingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const setOpen = (next: boolean): void => {
    if (next === open) return
    setOpenState(next)
    setToggling(true)
    clearTimeout(togglingTimer.current)
    // a backstop for a toggle whose width doesn't change, so no transitionend
    togglingTimer.current = setTimeout(() => setToggling(false), 1500)
  }
  // the action hooks live here, not in the dropdown, so a mutation started
  // from it keeps its handlers after the dropdown unmounts
  const actions = usePaletteActions()

  const close = (): void => {
    setOpen(false)
    setQuery('')
    inputRef.current?.blur()
  }

  const onShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return
    if (event.key.toLowerCase() !== 'k') return
    const inSearch = event.target === inputRef.current
    if (!open && !inSearch && (isTypingTarget(event.target) || isDialogOpen())) return
    event.preventDefault()
    setOpen(true)
    inputRef.current?.focus()
    inputRef.current?.select()
  })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => onShortcut(event)
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div
      className={className}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close()
      }}
    >
      <CommandPalette
        actions={actions}
        open={open}
        toggling={toggling}
        onToggled={() => setToggling(false)}
        query={query}
        setQuery={setQuery}
        inputRef={inputRef}
        onOpen={() => setOpen(true)}
        onClose={close}
        go={(fn) => {
          close()
          fn()
        }}
      />
    </div>
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
  const { theme, setTheme } = useTheme()
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
    theme,
    setTheme
  }
}

function CommandPalette({
  actions,
  go,
  open,
  query,
  setQuery,
  inputRef,
  onOpen,
  onClose,
  toggling,
  onToggled
}: {
  actions: ReturnType<typeof usePaletteActions>
  /** runs an entry that takes the user somewhere, closing the search first;
   * entries that act in place run directly and leave it open */
  go: (fn: () => void) => void
  open: boolean
  query: string
  setQuery: (query: string) => void
  inputRef: React.RefObject<HTMLInputElement | null>
  onOpen: () => void
  onClose: () => void
  toggling: boolean
  onToggled: () => void
}) {
  const term = useDebounced(query.trim(), 200)
  const searching = query.trim().length > 0
  const { navigate } = actions

  const accounts = useQuery(accountsOptions).data ?? []
  const reports = useQuery(reportsOptions).data ?? []
  const conversations = useConversations().data ?? []
  const connection = useQuery(connectionOptions).data
  // from the setting, not the page: this stays mounted in the title bar, and a
  // read of the html class would be memoized past the next theme switch
  const dark =
    actions.theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : actions.theme === 'dark'

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
    go(() => void navigate({ to: '/accounts', search: { tab: 'transactions', q: search } }))

  return (
    <Command
      filter={filterByKeywords}
      loop
      // one surface: closed it is a solid field on the canvas, easy to spot;
      // open it widens and the results grow down inside the same panel
      className={cn(
        '@container/search relative h-auto overflow-hidden transition-[box-shadow,background-color] duration-500 ease-palette motion-reduce:transition-none [&_[data-slot=command-group]]:px-2 [&_[data-slot=command-group]]:py-1.5 [&_[data-slot=command-item]]:min-h-8 [&_[data-slot=command-item]]:gap-3',
        toggling && 'transition-[width,translate,box-shadow,background-color]',
        open
          ? 'rounded-xl bg-popover shadow-lg ring-1 ring-foreground/10'
          : 'rounded-lg bg-card shadow-xs ring-1 ring-foreground/12 hover:ring-foreground/20 dark:bg-muted'
      )}
      style={open ? OPEN_SIZE : CLOSED_SIZE}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && event.propertyName === 'width') onToggled()
      }}
    >
      <CommandInput
        ref={inputRef}
        wrapperClassName={cn(
          'h-7 gap-2 border-0 border-b border-transparent transition-[height,padding,border-color] duration-500 ease-palette motion-reduce:transition-none',
          // closed, the placeholder stops short of the shortcut hint
          open ? 'h-9 border-border pr-9 pl-3' : 'pr-13 pl-2.5 @max-[12rem]/search:pr-2.5'
        )}
        className="h-full text-xs"
        value={query}
        onValueChange={(value) => {
          setQuery(value)
          if (!open) onOpen()
        }}
        // opens only on something the user does, never on focus alone: a
        // dialog that closes hands focus back here and must leave it shut
        onPointerDown={() => {
          if (!open) onOpen()
        }}
        onKeyDown={(event) => {
          if (!open && ['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
            event.preventDefault()
            onOpen()
            return
          }
          if (event.key !== 'Escape' || !open) return
          event.preventDefault()
          onClose()
        }}
        placeholder="Search pages, actions, and transactions…"
        aria-label="Search pages, actions, and transactions"
      />
      <kbd
        className={cn(
          'pointer-events-none absolute top-3.5 right-2 -translate-y-1/2 rounded border border-border px-1 font-sans text-caption text-muted-foreground transition-opacity duration-200 motion-reduce:transition-none @max-[12rem]/search:hidden',
          open && 'opacity-0'
        )}
      >
        {isMac ? '⌘K' : 'Ctrl K'}
      </kbd>
      <button
        type="button"
        aria-label="Clear search"
        tabIndex={open && query ? 0 : -1}
        // keeps focus in the field, so clearing never reads as a click outside
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          setQuery('')
          inputRef.current?.focus()
        }}
        className={cn(
          'absolute top-4.5 right-2.5 flex size-5 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-opacity duration-150 hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none',
          open && query ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
      >
        <HugeiconsIcon icon={Cancel01Icon} className="size-3.5" />
      </button>
      {/* the results stay mounted and fold open and shut (a grid row from 0fr to
          1fr), so opening and closing are the same gentle motion played both ways */}
      <div
        inert={!open}
        className={cn(
          'grid transition-[grid-template-rows,opacity,visibility] duration-500 ease-palette motion-reduce:transition-none',
          open ? 'visible grid-rows-[1fr] opacity-100' : 'invisible grid-rows-[0fr] opacity-0'
        )}
      >
        <div
          role="dialog"
          aria-label="Command palette"
          className="min-h-0 overflow-hidden"
          // clicks inside keep focus on the field, so choosing an item doesn't
          // blur it and close the panel first
          onMouseDown={(event) => event.preventDefault()}
        >
          <CommandList viewPortClassName="max-h-[min(420px,60vh)]">
            <CommandGroup heading="Actions">
              <PaletteItem
                id="action:new-transaction"
                label="New Transaction"
                icon={Add01Icon}
                onSelect={() =>
                  go(
                    () =>
                      void navigate({
                        to: '/accounts',
                        search: { tab: 'transactions', create: true }
                      })
                  )
                }
              />
              <PaletteItem
                id="action:import"
                label="Import"
                keywords={['file', 'csv', 'ofx', 'qif']}
                icon={FileImportIcon}
                onSelect={actions.openImport}
              />
              {connection && (
                <PaletteItem
                  id="action:sync"
                  label={actions.syncing ? 'Syncing…' : 'Sync Now'}
                  keywords={['simplefin', 'refresh']}
                  icon={RefreshIcon}
                  disabled={actions.syncing}
                  onSelect={actions.sync}
                />
              )}
              <PaletteItem
                id="action:categorize"
                label="Auto-Categorize"
                icon={AiMagicIcon}
                disabled={!actions.canCategorize}
                onSelect={actions.categorize}
              />
              <PaletteItem
                id="action:blur"
                label={actions.blurAmounts ? 'Show Amounts' : 'Hide Amounts'}
                keywords={['privacy', 'hide']}
                icon={actions.blurAmounts ? ViewIcon : ViewOffIcon}
                onSelect={actions.toggleBlur}
              />
              <PaletteItem
                id="action:theme"
                label={dark ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
                keywords={['theme', 'appearance', 'mode']}
                icon={dark ? Sun03Icon : Moon02Icon}
                onSelect={() => actions.setTheme(dark ? 'light' : 'dark')}
              />
            </CommandGroup>

            <CommandGroup heading="Go To">
              {PAGES.map((page) => (
                <PaletteItem
                  key={page.label}
                  id={`page:${page.label}`}
                  label={page.label}
                  icon={page.icon}
                  onSelect={() =>
                    go(
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
                      onSelect={() => go(() => actions.openSettings(section.id))}
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
                        go(
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
                        go(
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
                        go(() => void navigate({ to: '/chat', search: { c: conversation.id } }))
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
          <div className="flex items-center gap-4 border-t bg-tray px-4 py-2.5 text-xs text-muted-foreground">
            <span>
              <Key>↑</Key> <Key>↓</Key> to move
            </span>
            <span>
              <Key>Enter</Key> to open
            </span>
            <span className="ml-auto">
              <Key>Esc</Key> to close
            </span>
          </div>
        </div>
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
    <kbd className="lifted inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] px-1 font-sans text-caption text-foreground">
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
