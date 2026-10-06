import { expect } from 'vitest'
import type { ActionChange, SyncResult } from '@shared/ipc'
import { db } from '../../../demo/db'
import { accounts, connections, rules } from '../../db/schema'
import { api } from './api'
import { query } from './db'

// A sync may only write the columns a bank owns. The two a user owns,
// category_id and deleted_at, are touched by sync alone through the transfer
// detector and rules, and every such write is action-logged. This checks that
// after the fact, from the stored rows and the log.

type Row = {
  id: number
  category_id: number | null
  deleted_at: number | null
  pending: number
}

const rowsNow = (): Row[] =>
  query<Row>('SELECT id, category_id, deleted_at, pending FROM transactions ORDER BY id')

const newestEntry = (): number =>
  query<{ id: number | null }>('SELECT max(id) AS id FROM action_log')[0].id ?? 0

/** Snapshots now; call the returned function after the sync to assert it. */
export function beginSyncGuard(): (opts?: { failed?: boolean }) => void {
  const before = new Map(rowsNow().map((r) => [r.id, r]))
  const lastEntry = newestEntry()

  return ({ failed = false } = {}) => {
    const entries = query<{ source: string; changes: string }>(
      `SELECT source, changes FROM action_log WHERE id > ${lastEntry} ORDER BY id`
    )
    const after = new Map(rowsNow().map((r) => [r.id, r]))

    if (failed) {
      // a failed sync rolls back whole: no rows, no log entries
      expect(entries, 'a failed sync logged actions').toEqual([])
      expect([...after.values()], 'a failed sync changed transactions').toEqual([
        ...before.values()
      ])
      return
    }

    for (const entry of entries) {
      expect(['detector', 'rule'], 'a sync logged an action it should not own').toContain(
        entry.source
      )
    }

    // category writes the log accounts for, replayed in order from the old value
    const expected = new Map<number, number | null>()
    for (const entry of entries) {
      for (const change of JSON.parse(entry.changes) as ActionChange[]) {
        if (!('transactionId' in change) || change.field !== 'categoryId') continue
        const running = expected.has(change.transactionId)
          ? expected.get(change.transactionId)!
          : (before.get(change.transactionId)?.category_id ?? null)
        expect(
          change.before,
          `log entry misreports the old category of ${change.transactionId}`
        ).toBe(running)
        expected.set(change.transactionId, change.after)
      }
    }

    for (const [id, was] of before) {
      const now = after.get(id)
      if (!now) {
        // the only rows a sync may remove are pending ones, re-added by id
        expect(was.pending, `sync hard-deleted settled transaction ${id}`).toBe(1)
        continue
      }
      expect(now.deleted_at, `sync changed deleted_at on transaction ${id}`).toBe(was.deleted_at)
      expect(
        now.category_id,
        `transaction ${id} changed category without a matching detector/rule entry`
      ).toBe(expected.has(id) ? expected.get(id) : was.category_id)
    }
  }
}

/** api.connection.sync under the guard; a rejection must leave nothing behind. */
export async function guardedSync(): Promise<SyncResult> {
  const assertAfter = beginSyncGuard()
  let result: SyncResult
  try {
    result = await api.connection.sync()
  } catch (e) {
    assertAfter({ failed: true })
    throw e
  }
  assertAfter()
  return result
}

/** Back to a blank slate for the next spec: no connection, accounts, or rules. */
export async function resetSyncState(): Promise<void> {
  await api.connection.disconnect()
  db.delete(accounts).run()
  db.delete(connections).run()
  db.delete(rules).run()
  await api.settings.set('detectTransfers', true)
  await api.settings.set('applyRulesOnSync', true)
}
