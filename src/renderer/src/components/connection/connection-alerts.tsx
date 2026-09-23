import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { useIsMutating } from '@tanstack/react-query'
import { format, formatDistanceStrict } from 'date-fns'
import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon } from '@hugeicons/core-free-icons'
import { actionNeededErrors, sfinErrorSeverity, type Connection } from '@shared/ipc'
import { SYNC_MUTATION_KEY } from '@/hooks/use-connect-simplefin'
import { buttonVariants } from '@/components/ui/button'

// daily auto-sync makes a day old normal; two means syncs aren't landing
const STALE_AFTER_MS = 48 * 60 * 60 * 1000

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

/**
 * Everything wrong with the SimpleFIN connection, loudest first: a sync that
 * threw, auth failures the user must fix at the bridge, data gone stale, then
 * transient errlist notices. `action` (e.g. a sync button) rides the first notice.
 */
export function ConnectionAlerts({
  connection,
  action
}: {
  connection: Connection
  action?: ReactNode
}) {
  const now = useNow(60 * 1000)
  // a sync in flight is about to replace the failure/staleness verdict
  const syncing = useIsMutating({ mutationKey: SYNC_MUTATION_KEY }) > 0

  const lastSynced = connection.lastSyncedAt ? connection.lastSyncedAt * 1000 : null
  const failedAt = connection.lastSyncFailedAt ? connection.lastSyncFailedAt * 1000 : null
  const stale = lastSynced !== null && now - lastSynced > STALE_AFTER_MS
  // Developer-facing entries (gen.api) match neither bucket and are
  // intentionally not shown to the user.
  const actionNeeded = actionNeededErrors(connection.lastSyncErrors)
  const transient = connection.lastSyncErrors.filter((e) => sfinErrorSeverity(e) === 'transient')

  const bridgeLink = connection.bridgeUrl && (
    <a
      href={connection.bridgeUrl}
      target="_blank"
      rel="noreferrer"
      className={buttonVariants({ variant: 'outline' })}
    >
      Open SimpleFIN bridge
    </a>
  )

  const notices: (NoticeProps & { key: string })[] = []
  if (failedAt !== null && !syncing) {
    notices.push({
      key: 'failed',
      tone: 'error',
      title: `Last sync failed ${formatDistanceStrict(failedAt, now, { addSuffix: true })}`,
      hint: lastSynced
        ? `Your balances and transactions are from ${format(lastSynced, 'MMM d, p')}.`
        : 'Nothing has synced yet.',
      messages: [connection.lastSyncFailure ?? 'Unknown error'],
      actions: [bridgeLink]
    })
  }
  if (actionNeeded.length > 0) {
    notices.push({
      key: 'action',
      tone: 'error',
      title: 'SimpleFIN needs your attention',
      hint: 'Reconnect or re-authorize these at your SimpleFIN bridge, then sync again.',
      messages: actionNeeded.map((e) => e.msg),
      // one bridge button is enough when the failure notice above has it
      actions: notices.length > 0 ? [] : [bridgeLink]
    })
  }
  if (stale && lastSynced !== null && failedAt === null && !syncing) {
    notices.push({
      key: 'stale',
      tone: 'muted',
      title: `Accounts last synced ${formatDistanceStrict(lastSynced, now, { addSuffix: true })}`,
      hint: 'Balances and transactions may be out of date.'
    })
  }
  if (transient.length > 0) {
    notices.push({
      key: 'transient',
      tone: 'muted',
      title: 'SimpleFIN couldn’t fetch everything last sync',
      hint: 'These usually clear on the next sync.',
      messages: transient.map((e) => e.msg)
    })
  }
  if (notices.length === 0) return null

  return (
    <div className="space-y-2">
      {notices.map(({ key, actions = [], ...notice }, i) => (
        // the caller's action joins whichever notice leads
        <Notice
          key={key}
          {...notice}
          actions={i === 0 && action ? [action, ...actions] : actions}
        />
      ))}
    </div>
  )
}

interface NoticeProps {
  tone: 'error' | 'muted'
  title: string
  hint?: string
  messages?: string[]
  actions?: ReactNode[]
}

function Notice({ tone, title, hint, messages = [], actions = [] }: NoticeProps) {
  const isError = tone === 'error'
  const shown = actions.filter(Boolean)
  return (
    <div
      role={isError ? 'alert' : 'status'}
      className={
        isError
          ? 'flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400'
          : 'flex gap-3 rounded-lg border border-border bg-muted/50 p-3 text-muted-foreground'
      }
    >
      <HugeiconsIcon icon={Alert02Icon} size={18} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className={isError ? 'text-sm font-medium' : 'text-sm font-medium text-foreground'}>
          {title}
        </p>
        {hint && <p className="text-xs">{hint}</p>}
        {messages.length > 0 && (
          <ul
            className={
              isError
                ? 'space-y-1 text-sm text-amber-700/90 dark:text-amber-400/90'
                : 'space-y-1 text-sm'
            }
          >
            {messages.map((msg, i) => (
              <li key={i} className="leading-snug select-text">
                {msg}
              </li>
            ))}
          </ul>
        )}
      </div>
      {shown.length > 0 && (
        <div className="flex shrink-0 items-start gap-2 text-foreground">
          {shown.map((node, i) => (
            <Fragment key={i}>{node}</Fragment>
          ))}
        </div>
      )}
    </div>
  )
}
