import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ipcErrorMessage } from './utils'

// A failed read otherwise falls through to an "empty" state and a rejected
// mutation vanishes silently, so surface both as a toast by default. A caller
// that renders its own error UI (or deliberately ignores failures) opts out with
// `meta: { silenceError: true }` on the query/mutation.
function notifyError(error: unknown, meta: Record<string, unknown> | undefined): void {
  if (meta?.silenceError) return
  toast.error(ipcErrorMessage(error))
}

// module-level so non-component code (the undo history) can invalidate queries
export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => notifyError(error, query.meta)
  }),
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => notifyError(error, mutation.meta)
  }),
  defaultOptions: {
    queries: {
      // Reads are local SQLite over IPC and every mutation already invalidates
      // what it touched, so the web defaults (staleTime 0, refetch on focus)
      // buy nothing and cost a loading state on every mount. Holding data
      // briefly is what makes navigating between pages land populated.
      staleTime: 30_000,
      // alt-tabbing back into a desktop app should not re-flash the UI
      refetchOnWindowFocus: false
    }
  }
})
