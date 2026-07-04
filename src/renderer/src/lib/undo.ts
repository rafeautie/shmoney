import { queryClient } from '@/lib/query-client'

export interface UndoableAction {
  /** Shown in feedback toasts, e.g. "Undid: Delete 3 transactions" */
  label: string
  undo: () => Promise<unknown>
  redo: () => Promise<unknown>
}

const MAX_HISTORY = 100

// classic command stacks: undoing moves an action to `future`, redoing moves it
// back, and any new action invalidates everything that was undone
const past: UndoableAction[] = []
let future: UndoableAction[] = []
let busy = false

async function run(from: UndoableAction[], to: UndoableAction[], op: 'undo' | 'redo') {
  if (busy) return null
  const action = from.at(-1)
  if (!action) return null
  busy = true
  try {
    await action[op]()
    // pop only after success: a failed undo/redo stays on its stack for retry
    from.pop()
    to.push(action)
    return action.label
  } finally {
    busy = false
    queryClient.invalidateQueries()
  }
}

export const undoHistory = {
  /** Record a completed action so it can be undone */
  push(action: UndoableAction): void {
    past.push(action)
    if (past.length > MAX_HISTORY) past.shift()
    future = []
  },
  /** Resolves to the undone action's label, or null if there was nothing to undo */
  undo(): Promise<string | null> {
    return run(past, future, 'undo')
  },
  redo(): Promise<string | null> {
    return run(future, past, 'redo')
  }
}
