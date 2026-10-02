import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import type { ActionSource } from '@shared/ipc'

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

export const activityOptions = (filter: { source: ActionSource | null; q: string }) =>
  infiniteQueryOptions({
    queryKey: ['actionLog', 'page', filter],
    queryFn: ({ pageParam }) =>
      window.api.actionLog.page({
        before: pageParam,
        source: filter.source ?? undefined,
        q: filter.q || undefined
      }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.nextBefore ?? undefined
  })

export const connectionOptions = queryOptions({
  queryKey: ['connection'],
  queryFn: () => window.api.connection.get()
})
