import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Transaction } from '@shared/ipc'

// App-wide state for the transaction editor dialog. The dialog is mounted
// globally (TransactionEditorHost in the root layout), so any transactions view
// can open create (optionally defaulting the account) or edit (prefilled from
// the row snapshot) in place without navigating.
export type TransactionEditorState =
  { mode: 'create'; defaultAccountId?: number } | { mode: 'edit'; transaction: Transaction }

interface TransactionEditorUi {
  state: TransactionEditorState | null
  openCreate: (defaults?: { accountId?: number }) => void
  /** no-op for pending rows: sync drops and re-inserts them, edits would be lost */
  openEdit: (transaction: Transaction) => void
  close: () => void
}

const TransactionEditorContext = createContext<TransactionEditorUi | null>(null)

export function TransactionEditorProvider({
  children
}: {
  children: ReactNode
}): React.JSX.Element {
  const [state, setState] = useState<TransactionEditorState | null>(null)
  const value = useMemo(
    () => ({
      state,
      openCreate: (defaults?: { accountId?: number }) =>
        setState({ mode: 'create', defaultAccountId: defaults?.accountId }),
      openEdit: (transaction: Transaction) => {
        if (transaction.pending) return
        setState({ mode: 'edit', transaction })
      },
      close: () => setState(null)
    }),
    [state]
  )
  return (
    <TransactionEditorContext.Provider value={value}>{children}</TransactionEditorContext.Provider>
  )
}

export function useTransactionEditor(): TransactionEditorUi {
  const ctx = useContext(TransactionEditorContext)
  if (!ctx) throw new Error('useTransactionEditor must be used within a TransactionEditorProvider')
  return ctx
}
