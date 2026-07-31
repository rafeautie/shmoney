import { queryOptions } from '@tanstack/react-query'

/**
 * The query each page needs before it can render anything. Shared so a route
 * loader can warm the cache with `ensureQueryData` while the pointer is still
 * on the nav item, and the component's `useQuery` then reads the same entry
 * instead of mounting into a loading state.
 *
 * Only entry queries belong here; everything a page fetches after it is on
 * screen stays inline where it is used.
 */
export const accountsOptions = queryOptions({
  queryKey: ['accounts'],
  queryFn: () => window.api.accounts.list()
})

export const accountOptions = (id: number) =>
  queryOptions({
    queryKey: ['accounts', 'detail', id],
    queryFn: () => window.api.accounts.get(id)
  })

export const reportsOptions = queryOptions({
  queryKey: ['reports'],
  queryFn: () => window.api.reports.list()
})

export const reportOptions = (id: number) =>
  queryOptions({
    queryKey: ['report', id],
    queryFn: () => window.api.reports.get(id)
  })

export const actionLogOptions = queryOptions({
  queryKey: ['actionLog'],
  queryFn: () => window.api.actionLog.list()
})
