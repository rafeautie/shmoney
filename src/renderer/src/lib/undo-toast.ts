import type { QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { invalidateUndoableData } from '@/lib/invalidate'

/** Says so when an undo or redo changed nothing: everything it covered was edited since. */
export function toastSuperseded(direction: 'undo' | 'redo'): void {
  toast(`Nothing to ${direction}. Everything it changed has been edited since.`)
}

/** Confirm a logged action happened, with an Undo that replays the same entry
 *  Ctrl+Z would. For deletes that skip the confirmation because undo exists. */
export function toastUndoable(label: string, actionId: number, queryClient: QueryClient): void {
  toast(label, {
    action: {
      label: 'Undo',
      onClick: () => {
        window.api.actionLog
          .undoEntry(actionId)
          .then((result) => {
            if (result.applied === 0) toastSuperseded('undo')
            invalidateUndoableData(queryClient)
          })
          .catch(() => {})
      }
    }
  })
}
