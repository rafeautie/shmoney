import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export interface NotifyAction {
  label: string
  onClick: () => void
}

export interface Message {
  id: number
  title: string
  description?: string
  variant: 'default' | 'error'
  action?: NotifyAction
  /** unix millis when the user first saw this message (center opened); null = unread */
  seenAt: number | null
}

export interface NotifyOptions {
  description?: string
  action?: NotifyAction
}

interface Store {
  messages: Message[]
  push: (input: Omit<Message, 'id' | 'seenAt'>) => void
  markAllSeen: () => void
  pruneExpired: () => void
  clearAll: () => void
}

// keep the panel a "recent activity" list, not an unbounded log
const MAX_MESSAGES = 20

// how long a seen message lingers before the open/close sweeps drop it
const SEEN_TTL_MS = 5 * 60 * 1000

let nextId = 0

const NotifyContext = createContext<Store | null>(null)

/**
 * Session-scoped store behind the sidebar notification center. Completed one-shot
 * messages (what used to be toasts) live here. Opening the center marks them seen
 * (clearing the badge); a seen message then lingers for SEEN_TTL_MS so it can be
 * re-read, and the open/close sweeps (pruneExpired) drop it once that passes —
 * no timers, so nothing vanishes mid-view. Clear all empties the list at once.
 * Not persisted — a restart starts clean.
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<Message[]>([])

  const push = useCallback((input: Omit<Message, 'id' | 'seenAt'>) => {
    const message: Message = { ...input, id: nextId++, seenAt: null }
    setMessages((prev) => [message, ...prev].slice(0, MAX_MESSAGES))
  }, [])

  const markAllSeen = useCallback(() => {
    const now = Date.now()
    setMessages((prev) =>
      prev.some((m) => m.seenAt === null)
        ? prev.map((m) => (m.seenAt === null ? { ...m, seenAt: now } : m))
        : prev
    )
  }, [])

  const pruneExpired = useCallback(() => {
    const cutoff = Date.now() - SEEN_TTL_MS
    setMessages((prev) =>
      prev.some((m) => m.seenAt !== null && m.seenAt < cutoff)
        ? prev.filter((m) => m.seenAt === null || m.seenAt >= cutoff)
        : prev
    )
  }, [])

  const clearAll = useCallback(() => {
    setMessages((prev) => (prev.length > 0 ? [] : prev))
  }, [])

  const value = useMemo(
    () => ({ messages, push, markAllSeen, pruneExpired, clearAll }),
    [messages, push, markAllSeen, pruneExpired, clearAll]
  )
  return <NotifyContext.Provider value={value}>{children}</NotifyContext.Provider>
}

function useStore(): Store {
  const store = useContext(NotifyContext)
  if (!store) throw new Error('useNotify must be used within a NotificationsProvider')
  return store
}

export interface Notify {
  (title: string, options?: NotifyOptions): void
  error: (title: string, options?: NotifyOptions) => void
}

/** Push a message into the notification center. Drop-in for the old `toast(...)`. */
export function useNotify(): Notify {
  const { push } = useStore()
  return useMemo(() => {
    const notify = ((title, options) => push({ title, variant: 'default', ...options })) as Notify
    // eslint-disable-next-line react-hooks/immutability -- construction of the callable-with-method shape inside the memo, not a mutation of shared state
    notify.error = (title, options) => push({ title, variant: 'error', ...options })
    return notify
  }, [push])
}

/** The center's own read/clear access to the message store. */
export function useNotifyStore(): {
  messages: Message[]
  markAllSeen: () => void
  pruneExpired: () => void
  clearAll: () => void
} {
  const { messages, markAllSeen, pruneExpired, clearAll } = useStore()
  return { messages, markAllSeen, pruneExpired, clearAll }
}
