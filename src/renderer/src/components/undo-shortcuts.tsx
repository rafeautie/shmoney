import { useEffect } from 'react'
import { toast } from 'sonner'
import { undoHistory } from '@/lib/undo'

/** App-wide Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y for the undo history. Skipped while
 * typing so text fields keep their native editing undo. */
export function UndoShortcuts() {
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
      undoHistory[verb]().then(
        (label) => toast(label ? `${isRedo ? 'Redo' : 'Undo'}: ${label}` : `Nothing to ${verb}`),
        () => toast.error(`Couldn't ${verb} the last action`)
      )
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  return null
}
