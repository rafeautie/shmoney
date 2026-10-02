import { createContext, use, useMemo } from 'react'
import {
  hashKey,
  useMutation,
  useQueryClient,
  type InfiniteData,
  type QueryClient
} from '@tanstack/react-query'
import { toast } from 'sonner'
import type { CategoriesList, Page, Transaction, TransactionSortBy } from '@shared/ipc'
import type { ResolvedTransactionFilters } from '@shared/transaction-filters'
import { ipcErrorMessage } from '@/lib/utils'
import { invalidateTransactionData, isTransactionDerived } from '@/lib/invalidate'

type UpdateInput = Parameters<typeof window.api.transactions.update>[0]
type EditedField = 'description' | 'amount' | 'date' | 'category'
type TransactionPages = InfiniteData<Page<Transaction>>

export interface TransactionEdits {
  /** One cell edit; failures are toasted, so this never rejects */
  update: (input: UpdateInput) => Promise<void>
  /** Rejects on failure, so the caller can keep its picker open */
  setCategory: (transactionId: number, categoryId: number | null) => Promise<unknown>
}

export const TransactionEditsContext = createContext<TransactionEdits | null>(null)

export function useTransactionEditsContext(): TransactionEdits {
  const edits = use(TransactionEditsContext)
  if (!edits) throw new Error('Transaction cells must render inside a TransactionsTable')
  return edits
}

/** Whether editing `field` can move a row in, out of, or within a list with these filters and sort. */
export function editCanMoveRow(
  field: EditedField,
  filters: ResolvedTransactionFilters | undefined,
  sortBy: TransactionSortBy
): boolean {
  if (!filters) return true
  switch (field) {
    case 'description':
      return sortBy === 'description' || !!filters.search || !!filters.descriptionSearch?.length
    case 'amount':
      return (
        sortBy === 'amount' ||
        filters.direction !== 'all' ||
        filters.amountMin != null ||
        filters.amountMax != null
      )
    case 'date':
      return sortBy === 'date' || filters.dateStart !== null || filters.dateEnd !== null
    case 'category':
      // search matches category names too, and transfers are a category
      return (
        filters.categoryIds !== undefined ||
        filters.categoryGroupIds !== undefined ||
        filters.includeUncategorized !== undefined ||
        !filters.includeTransfers ||
        filters.direction !== 'all' ||
        !!filters.search
      )
  }
}

function isTransactionPages(data: unknown): data is TransactionPages {
  return (
    typeof data === 'object' && data !== null && Array.isArray((data as TransactionPages).pages)
  )
}

/** Writes an edit into every cached transaction list so the cell updates before any refetch. */
export function patchCachedTransaction(
  queryClient: QueryClient,
  id: number,
  patch: Partial<Transaction>
): void {
  queryClient.setQueriesData<TransactionPages>(
    { predicate: (query) => isTransactionDerived(query) && isTransactionPages(query.state.data) },
    (data) => {
      if (!data || !data.pages.some((page) => page.rows.some((row) => row.id === id))) return data
      return {
        ...data,
        pages: data.pages.map((page) =>
          page.rows.some((row) => row.id === id)
            ? {
                ...page,
                rows: page.rows.map((row) => (row.id === id ? { ...row, ...patch } : row))
              }
            : page
        )
      }
    }
  )
}

function categoryPatch(
  queryClient: QueryClient,
  categoryId: number | null
): Partial<Transaction> | null {
  if (categoryId === null) return { categoryId, categoryName: null, isTransfer: false }
  const list = queryClient.getQueryData<CategoriesList>(['categories'])
  const category = [
    ...(list?.groups.flatMap((group) => group.categories) ?? []),
    ...(list?.ungrouped ?? []),
    ...(list?.system ?? [])
  ].find((c) => c.id === categoryId)
  if (!category) return null
  return { categoryId, categoryName: category.name, isTransfer: category.systemKey === 'transfers' }
}

function updatePatch(input: UpdateInput): Partial<Transaction> {
  const patch: Partial<Transaction> = {}
  if (input.description !== undefined) patch.description = input.description.trim()
  if (input.amount !== undefined) patch.amount = input.amount
  if (input.date !== undefined) {
    // the main process anchors a calendar day at local noon
    const [year, month, day] = input.date.split('-').map(Number)
    patch.date = new Date(year, month - 1, day, 12).getTime() / 1000
  }
  return patch
}

function updatedFields(input: UpdateInput): EditedField[] {
  const fields: EditedField[] = []
  if (input.description !== undefined) fields.push('description')
  if (input.amount !== undefined) fields.push('amount')
  if (input.date !== undefined) fields.push('date')
  if (input.categoryId !== undefined) fields.push('category')
  return fields
}

/**
 * The row-level edits for one transactions table, hoisted here so rows carry no
 * mutation observers. Each edit patches the cached row at once; the table's own
 * list is refetched only when the edit can change which rows it shows or their
 * order, while totals, balances and other lists always refresh.
 */
export function useTransactionEdits({
  listKey,
  filters,
  sortBy
}: {
  listKey: readonly unknown[]
  /** undefined = unknown, so every edit refetches the list */
  filters: ResolvedTransactionFilters | undefined
  sortBy: TransactionSortBy
}): TransactionEdits {
  const queryClient = useQueryClient()
  const listHash = hashKey(listKey)

  // not awaited, so callers resolve (and pickers close) as soon as the write lands
  const refresh = (fields: EditedField[], failed: boolean) => {
    if (failed || fields.some((field) => editCanMoveRow(field, filters, sortBy))) {
      void invalidateTransactionData(queryClient)
      return
    }
    // the patched row is already right; just mark the list stale for its next mount
    void queryClient.invalidateQueries({
      predicate: (query) => query.queryHash === listHash,
      refetchType: 'none'
    })
    void queryClient.invalidateQueries({
      predicate: (query) => query.queryHash !== listHash && isTransactionDerived(query)
    })
  }

  // every cell edit goes through transactions:update, which records an undoable
  // action-log entry per changed field; the cell updating is the feedback (no toast)
  const { mutateAsync: update } = useMutation({
    mutationFn: (input: UpdateInput) => window.api.transactions.update(input),
    onMutate: (input) => patchCachedTransaction(queryClient, input.id, updatePatch(input)),
    onError: (error) => toast(ipcErrorMessage(error)),
    onSettled: (_data, error, input) => refresh(updatedFields(input), error !== null)
  })

  // the main-process handler records the change to the action log for undo
  const { mutateAsync: setCategory } = useMutation({
    mutationFn: (change: { transactionId: number; categoryId: number | null }) =>
      window.api.transactions.setCategories({ changes: [change] }),
    onMutate: ({ transactionId, categoryId }) => {
      const patch = categoryPatch(queryClient, categoryId)
      if (patch) patchCachedTransaction(queryClient, transactionId, patch)
      return { patched: patch !== null }
    },
    onSettled: (_data, error, _change, context) =>
      refresh(['category'], error !== null || !context?.patched)
  })

  return useMemo(
    () => ({
      update: (input) =>
        update(input).then(
          () => undefined,
          () => undefined
        ),
      setCategory: (transactionId, categoryId) => setCategory({ transactionId, categoryId })
    }),
    [update, setCategory]
  )
}
