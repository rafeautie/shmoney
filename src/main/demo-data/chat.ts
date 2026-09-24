import { sql } from 'drizzle-orm'
import type {
  ChartSpec,
  ChatMessagePart,
  DateUnit,
  DateWindowToolResult,
  QueryToolResult
} from '@shared/chat'
import { db } from '../db'
import { prepareChart } from '../llm/tools/chart-tool'
import { evaluateExpression } from '../llm/tools/calc-tool'
import { resolveDateWindow } from '../llm/tools/resolve-dates-tool'
import { scopeViewsDdl, shapeResult } from '../llm/tools/sql-tool'
import type { ChatScript } from './types'

// Seeded chat transcripts. The model runs on-device, so the demo can't answer
// live; instead each scripted turn runs its SQL through the same scope views
// and chart preparation the real chat tools use, over the freshly seeded data.
// The numbers in a transcript are therefore always the dataset's own.

// deterministic stand-ins for how long the model spent on each step
const thinkMs = (text: string): number => 200 + text.length * 6
const CALL_MS = 640

export class Turn {
  readonly parts: ChatMessagePart[] = []
  private lastQuery: QueryToolResult | null = null

  constructor(readonly today: string) {}

  think(text: string): void {
    this.parts.push({ type: 'reasoning', text, durationMs: thinkMs(text) })
  }

  say(text: string): void {
    this.parts.push({ type: 'text', text })
  }

  query(statement: string): unknown[][] {
    const rows = db.all<Record<string, unknown>>(sql.raw(statement))
    const columns = rows.length > 0 ? Object.keys(rows[0]) : []
    const result = shapeResult(
      columns,
      rows.map((row) => columns.map((c) => row[c])),
      1
    )
    this.lastQuery = result
    this.parts.push({
      type: 'functionCall',
      durationMs: CALL_MS,
      name: 'query',
      args: { sql: statement },
      result
    })
    return result.rows ?? []
  }

  dates(args: { unit: DateUnit; count: number; includeCurrent: boolean }): DateWindowToolResult {
    const result = resolveDateWindow(args, this.today)
    this.parts.push({
      type: 'functionCall',
      durationMs: CALL_MS,
      name: 'resolve_dates',
      args,
      result
    })
    return result
  }

  calc(expression: string): number {
    const result = evaluateExpression(expression)
    this.parts.push({
      type: 'functionCall',
      durationMs: CALL_MS,
      name: 'calc',
      args: { expression },
      result
    })
    return result.value ?? 0
  }

  chart(spec: ChartSpec): void {
    const prepared = prepareChart(spec, this.lastQuery)
    if (!prepared.ok) throw new Error(`demo chart "${spec.title}": ${prepared.error}`)
    this.parts.push({
      type: 'functionCall',
      durationMs: CALL_MS,
      name: 'chart',
      args: spec,
      result: { ok: true },
      display: { data: prepared.data, currency: 'USD', series: prepared.series }
    })
  }
}

/** Run a script's turn with the chat tool's all-accounts views in place. */
export function runChatScript(script: ChatScript, today: string): ChatMessagePart[] {
  const ddl = scopeViewsDdl({ accountId: null })
  // temp views shadow the real tables for unqualified names on this
  // connection, so they must be gone before any other code queries it
  const views = ddl.flatMap((s) => /^CREATE TEMP VIEW (\w+)/.exec(s)?.[1] ?? [])
  try {
    for (const statement of ddl) db.run(sql.raw(statement))
    const turn = new Turn(today)
    script.answer(turn)
    return turn.parts
  } finally {
    for (const view of views) db.run(sql.raw(`DROP VIEW IF EXISTS temp.${view}`))
  }
}
