import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

/** App-wide Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y over the persisted action log. Undo
 * targets the newest applied entry, redo the most recently undone one. Skipped
 * while typing so text fields keep their native editing undo. */
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
      const verb = isRedo ? 'redo' : 'undo'
      const run = isRedo ? window.api.actionLog.redo() : window.api.actionLog.undo()
      run
        .then((result) => {
          if (!result) {
            toast(`Nothing to ${verb}`)
            return
          }
          queryClient.invalidateQueries()
          toast(`${isRedo ? 'Redo' : 'Undo'} ${result.label}`)
        })
        .catch(() => toast.error(`Couldn't ${verb} the last action`))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [queryClient])
  return null
}
