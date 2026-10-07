import { expect } from 'vitest'
import { api } from './api'
import { query, snapshot } from './db'

/**
 * Runs a logged mutation, then proves its action-log entry is a faithful
 * inverse: undo returns every user table to the before state, redo to the
 * after state. Resolves to the entry id.
 */
export async function expectUndoRoundTrip(mutate: () => Promise<unknown>): Promise<number> {
  const newest = (): number =>
    query<{ id: number | null }>('SELECT max(id) AS id FROM action_log')[0].id ?? 0
  const lastBefore = newest()
  const before = snapshot()
  await mutate()
  const entryId = newest()
  expect(entryId, 'the mutation wrote no action-log entry').toBeGreaterThan(lastBefore)
  const after = snapshot()
  expect(after, 'the mutation changed nothing').not.toEqual(before)

  const undone = await api.actionLog.undoEntry(entryId)
  expect(undone.applied, 'undo applied nothing').toBeGreaterThan(0)
  expect(snapshot()).toEqual(before)

  const redone = await api.actionLog.redoEntry(entryId)
  expect(redone.applied, 'redo applied nothing').toBeGreaterThan(0)
  expect(snapshot()).toEqual(after)
  return entryId
}
