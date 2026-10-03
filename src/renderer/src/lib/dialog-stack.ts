import { useLayoutEffect, useSyncExternalStore } from 'react'

// Every open dialog in open order. base-ui only links dialogs nested in the
// React tree, but root-level hosts (import, rule suggestions) open as siblings
// of whatever is showing, so stacking is tracked here for both.
let stack: string[] = []
const listeners = new Set<() => void>()

function set(next: string[]): void {
  stack = next
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Holds this dialog's place in the stack while it is open. Layout effect, so a
 * second dialog's backdrop never paints a frame before it learns it's stacked. */
export function useStackedDialog(id: string, open: boolean): void {
  useLayoutEffect(() => {
    if (!open) return
    set([...stack, id])
    return () => set(stack.filter((s) => s !== id))
  }, [id, open])
}

/** How many open dialogs sit below and above this one. */
export function useDialogStackPosition(id: string): { below: number; above: number } {
  const current = useSyncExternalStore(subscribe, () => stack)
  const index = current.indexOf(id)
  if (index === -1) return { below: 0, above: 0 }
  return { below: index, above: current.length - 1 - index }
}
