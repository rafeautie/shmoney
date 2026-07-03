import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { PaginationState, SortingState } from '@tanstack/react-table'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function ipcErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  // Electron prefixes IPC rejections with "Error invoking remote method 'x':"
  return message.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
}

/** Maps table state to the paged IPC query shape. Column ids must match the endpoint's sortBy values. */
export function pageQuery<S extends string>(
  sorting: SortingState,
  pagination: PaginationState,
  defaultSort: { id: S; desc: boolean }
): { page: number; pageSize: number; sortBy: S; sortDir: 'asc' | 'desc' } {
  const sort = (sorting[0] ?? defaultSort) as { id: S; desc: boolean }
  return {
    page: pagination.pageIndex,
    pageSize: pagination.pageSize,
    sortBy: sort.id,
    sortDir: sort.desc ? 'desc' : 'asc'
  }
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
