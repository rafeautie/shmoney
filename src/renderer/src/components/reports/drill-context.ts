import { createContext, useContext } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { TransactionFilters } from '@shared/transaction-filters'

export type OpenDrill = (filters: TransactionFilters) => void

export const DrillContext = createContext<OpenDrill | null>(null)

/** Opens a mark's transactions: in the report's side panel when there is one,
 * otherwise on the All Transactions tab. */
export function useOpenTransactions(): OpenDrill {
  const panel = useContext(DrillContext)
  const navigate = useNavigate()
  return (
    panel ??
    ((filters) => void navigate({ to: '/accounts', search: { tab: 'transactions', filters } }))
  )
}
