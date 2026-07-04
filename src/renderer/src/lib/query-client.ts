import { QueryClient } from '@tanstack/react-query'

// module-level so non-component code (the undo history) can invalidate queries
export const queryClient = new QueryClient()
