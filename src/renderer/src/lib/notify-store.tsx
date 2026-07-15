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
  /** true once the user has opened the center while this message was present */
  seen: boolean
}

export interface NotifyOptions {
  description?: string
  action?: NotifyAction
}

interface Store {
  messages: Message[]
  push: (input: Omit<Message, 'id' | 'seen'>) => void
  markAllSeen: () => void
  pruneSeen: () => void
}

// keep the panel a "recent activity" list, not an unbounded log
const MAX_MESSAGES = 20

let nextId = 0

const NotifyContext = createContext<Store | null>(null)

/**
 * Session-scoped store behind the sidebar notification center. Completed one-shot
 * messages (what used to be toasts) live here until the user opens the center:
 * opening marks them seen, closing drops the seen ones. Not persisted — a restart
 * starts clean.
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<Message[]>([])

  const push = useCallback((input: Omit<Message, 'id' | 'seen'>) => {
    const message: Message = { ...input, id: nextId++, seen: false }
    setMessages((prev) => [message, ...prev].slice(0, MAX_MESSAGES))
  }, [])

  const markAllSeen = useCallback(() => {
    setMessages((prev) =>
      prev.some((m) => !m.seen) ? prev.map((m) => ({ ...m, seen: true })) : prev
    )
  }, [])

  const pruneSeen = useCallback(() => {
    setMessages((prev) => (prev.some((m) => m.seen) ? prev.filter((m) => !m.seen) : prev))
  }, [])

  const value = useMemo(
    () => ({ messages, push, markAllSeen, pruneSeen }),
    [messages, push, markAllSeen, pruneSeen]
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
  pruneSeen: () => void
} {
  const { messages, markAllSeen, pruneSeen } = useStore()
  return { messages, markAllSeen, pruneSeen }
}
