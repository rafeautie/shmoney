import { useEffect } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { UndoResult } from '@shared/ipc'
import { Badge } from '@/components/ui/badge'

type Direction = 'undo' | 'redo'

// how long the confirmation stays up before auto-dismissing
const DURATION_MS = 6000

// Bottom-right toast confirming a keyboard undo/redo (bottom-right so it clears
// the bottom-center bulk-action bar). The action button reverses that exact entry
// via the unrestricted per-entry handlers, then re-shows the toast flipped — so
// the confirmation itself is a toggle you can bounce between.
function showUndoToast(result: UndoResult, direction: Direction, queryClient: QueryClient): void {
  const undone = direction === 'undo'
  toast(
    <span className="flex min-w-0 items-center gap-2">
      <Badge variant="secondary">{undone ? 'Undone' : 'Redone'}</Badge>
      <span className="truncate">{result.label}</span>
    </span>,
    {
      duration: DURATION_MS,
      action: {
        label: undone ? 'Redo' : 'Undo',
        onClick: () => {
          const run = undone
            ? window.api.actionLog.redoEntry(result.id)
            : window.api.actionLog.undoEntry(result.id)
          run
            .then((next) => {
              queryClient.invalidateQueries()
              showUndoToast(next, undone ? 'redo' : 'undo', queryClient)
            })
            .catch(() => {})
        }
      }
    }
  )
}

/** App-wide Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y over the persisted action log. To match
 * how standard undo behaves — and to stop a stray keystroke from silently rewinding
 * work — the keyboard path reaches only YOUR actions from the current session
 * (scoped in the main process) and every hit raises a toast you can reverse. The
 * Activity page stays the place to undo automated or older changes. Skipped while
 * typing so text fields keep their native editing undo. */
export function UndoShortcuts() {
  const queryClient = useQueryClient()

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const key = event.key.toLowerCase()
      const isRedo = key === 'y' || (key === 'z' && event.shiftKey)
      const isUndo = key === 'z' && !event.shiftKey
      if (!isUndo && !isRedo) return
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return
      }
      event.preventDefault()
      const run = isRedo ? window.api.actionLog.redo() : window.api.actionLog.undo()
      run
        .then((result) => {
          // null = nothing of yours to undo this session; stay silent, like a
          // browser's Ctrl+Z on an empty stack
          if (!result) return
          queryClient.invalidateQueries()
          showUndoToast(result, isRedo ? 'redo' : 'undo', queryClient)
        })
        .catch(() => {})
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [queryClient])

  return null
}
