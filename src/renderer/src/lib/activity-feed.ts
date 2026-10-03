import type { ActionLogEntry, ActionRun, ActionSource } from '@shared/ipc'
import { plural } from './utils'

type FeedItem =
  | { kind: 'entry'; entry: ActionLogEntry; createdAt: number }
  | { kind: 'run'; run: ActionRun; entries: ActionLogEntry[]; createdAt: number }

export interface FeedDay {
  /** local calendar day, for the heading */
  date: Date
  items: FeedItem[]
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/**
 * Newest-first entries into day groups. With grouping on, a run's entries fold
 * into one run item; a run with a single entry stays a plain row. Filtered views
 * pass grouping off and list every entry on its own.
 */
export function buildFeed(
  entries: ActionLogEntry[],
  runs: Record<number, ActionRun>,
  grouping: boolean
): FeedDay[] {
  const items: FeedItem[] = []
  for (const entry of entries) {
    const run = entry.runId !== null ? runs[entry.runId] : undefined
    const last = items.at(-1)
    if (grouping && run && last?.kind === 'run' && last.run.id === run.id) {
      last.entries.push(entry)
    } else if (grouping && run) {
      items.push({ kind: 'run', run, entries: [entry], createdAt: run.createdAt })
    } else {
      items.push({ kind: 'entry', entry, createdAt: entry.createdAt })
    }
  }

  const days: FeedDay[] = []
  for (const raw of items) {
    const item: FeedItem =
      raw.kind === 'run' && raw.entries.length === 1
        ? { kind: 'entry', entry: raw.entries[0], createdAt: raw.entries[0].createdAt }
        : raw
    const date = new Date(item.createdAt)
    const day = days.at(-1)
    if (day && sameDay(day.date, date)) day.items.push(item)
    else days.push({ date, items: [item] })
  }
  return days
}

/** One line on what a run did, e.g. "8 rules categorized 283 transactions · Detected 3 transfers". */
export function runSummary(entries: ActionLogEntry[]): string {
  const rules = entries.filter((e) => e.source === 'rule')
  const ai = entries.filter((e) => e.source === 'llm')
  const parts = [
    ...entries.filter((e) => e.source === 'import').map((e) => e.label),
    ...entries.filter((e) => e.source === 'detector').map((e) => e.label)
  ]
  if (rules.length > 0) {
    const rows = rules.reduce((n, e) => n + e.changeCount, 0)
    parts.push(`${plural(rules.length, 'rule')} categorized ${plural(rows, 'transaction')}`)
  }
  if (ai.length > 0) {
    const rows = ai.reduce((n, e) => n + e.changeCount, 0)
    parts.push(`AI categorized ${plural(rows, 'transaction')}`)
  }
  parts.push(...entries.filter((e) => e.source === 'user').map((e) => e.label))
  return parts.join(' · ')
}

/** Filter chip names, in chip order. */
export const SOURCE_LABELS: Record<ActionSource, string> = {
  user: 'You',
  rule: 'Rules',
  detector: 'Transfers',
  llm: 'AI',
  import: 'Imports'
}

/** How an automated entry credits itself in its subtitle. */
export const SOURCE_CREDIT: Partial<Record<ActionSource, string>> = {
  rule: 'Rule',
  detector: 'Transfer detection',
  llm: 'AI',
  import: 'Import'
}
