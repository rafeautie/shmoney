import type { QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { invalidateUndoableData } from '@/lib/invalidate'

/** Confirm a logged action happened, with an Undo that replays the same entry
 *  Ctrl+Z would. For deletes that skip the confirmation because undo exists. */
export function toastUndoable(label: string, actionId: number, queryClient: QueryClient): void {
  toast(label, {
    action: {
      label: 'Undo',
      onClick: () => {
        window.api.actionLog
          .undoEntry(actionId)
          .then(() => invalidateUndoableData(queryClient))
          .catch(() => {})
      }
    }
  })
}
