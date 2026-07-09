import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { SortingState } from '@tanstack/react-table'
import type { Page } from '@shared/ipc'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/** Aligns first/last cell content with p-6 chrome when a table bleeds to its container's edges;
 * set --table-edge on an ancestor to match tighter chrome (e.g. a px-4 card) */
export const TABLE_BLEED =
  '[&_th:first-child]:pl-[var(--table-edge,1.5rem)] [&_td:first-child]:pl-[var(--table-edge,1.5rem)] [&_th:last-child]:pr-[var(--table-edge,1.5rem)] [&_td:last-child]:pr-[var(--table-edge,1.5rem)]'

export function ipcErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  // Electron prefixes IPC rejections with "Error invoking remote method 'x':"
  return message.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
}

export const PAGE_SIZE = 50

/** Maps table sorting state to the IPC query shape. Column ids must match the endpoint's sortBy values. */
export function sortQuery<S extends string>(
  sorting: SortingState,
  defaultSort: { id: S; desc: boolean }
): { sortBy: S; sortDir: 'asc' | 'desc' } {
  const sort = (sorting[0] ?? defaultSort) as { id: S; desc: boolean }
  return { sortBy: sort.id, sortDir: sort.desc ? 'desc' : 'asc' }
}

/** getNextPageParam for useInfiniteQuery over the paged IPC endpoints */
export function nextPageParam<T>(lastPage: Page<T>, pages: Page<T>[]): number | undefined {
  const loaded = pages.reduce((count, page) => count + page.rows.length, 0)
  return loaded < lastPage.total ? pages.length : undefined
}

/** Stable within a calendar day, so resolved relative ranges (and the React
 * Query keys built from them) don't churn on every render. */
export function startOfTodayEpoch(): number {
  const now = new Date()
  return Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000)
}

/** "1 transaction" / "3 transactions" */
export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/** Share/quantity count with up to 8 fractional digits, trailing zeros trimmed
 * (handles both large lots like 15359.23 and tiny crypto fractions like 0.01725554). */
export function formatShares(value: string | number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 8 }).format(Number(value))
}

export function formatAmount(milliunits: number, currency: string): string {
  const value = milliunits / 1000
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value)
  } catch {
    // SimpleFIN allows custom currency URLs that Intl rejects
    return `${value.toFixed(2)} ${currency}`
  }
}
