import { sql, type SQL } from 'drizzle-orm'
import type { AnalysisToolName, ChartSpec, ChatMessagePart, QueryToolResult } from '@shared/chat'
import { db } from '../db'
import { prepareChart } from '../llm/tools/chart-tool'
import { evaluateExpression } from '../llm/tools/calc-tool'
import {
  GOAL_HISTORY_INSERT_SQL,
  GOAL_INSERT_SQL,
  goalTableDdl,
  scopeViewsDdl,
  shapeResult
} from '../llm/tools/sql-tool'
import { goalInputs } from '../llm/features/chat'
import { ANALYSIS_RUNNERS, type AnalysisContext } from '../llm/tools/analysis'
import type { GoalPaceInput, ToolDb, ToolOutput } from '../llm/tools/analysis/common'
import type { ChatScript } from './types'

// Seeded chat transcripts. The model runs on-device, so the demo can't answer
// live; instead each scripted turn runs its SQL through the same scope views
// and chart preparation the real chat tools use, over the freshly seeded data.
// The numbers in a transcript are therefore always the dataset's own.

/** a '?'-placeholder statement as drizzle SQL, binding each value in order */
function bound(text: string, params: unknown[]): SQL {
  const pieces = text.split('?')
  const chunks: SQL[] = [sql.raw(pieces[0])]
  params.forEach((value, i) => chunks.push(sql`${value}`, sql.raw(pieces[i + 1] ?? '')))
  return sql.join(chunks)
}

// the typed tools read through this, so a script runs them over the same
// connection whether it's better-sqlite3 in Electron or sql.js on the web
const toolDb: ToolDb = {
  prepare: (text) => ({
    all: (...params) => db.all(bound(text, params)),
    get: (...params) => db.get(bound(text, params))
  })
}

function scriptContext(today: string, goalPace: GoalPaceInput[]): AnalysisContext {
  const span = db.get<{ min: string | null; max: string | null }>(
    sql.raw('SELECT MIN(txn_date) AS min, MAX(txn_date) AS max FROM tx')
  )
  const names = (statement: string): string[] =>
    db.all<{ name: string }>(sql.raw(statement)).map((r) => r.name)
  return {
    db: toolDb,
    today,
    data: span?.min && span.max ? { min: span.min, max: span.max } : null,
    vocab: {
      categories: names(
        "SELECT name FROM categories WHERE system_key IS NULL OR system_key = 'income' ORDER BY name"
      ),
      accounts: names('SELECT name FROM accounts ORDER BY name'),
      goals: goalPace.map((goal) => goal.name)
    },
    goalPace
  }
}

// deterministic stand-ins for how long the model spent on each step
const thinkMs = (text: string): number => 200 + text.length * 6
const CALL_MS = 640

export class Turn {
  readonly parts: ChatMessagePart[] = []
  private lastQuery: QueryToolResult | null = null

  constructor(
    readonly today: string,
    private readonly goalPace: GoalPaceInput[]
  ) {}

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

  /** a typed tool call, drawing its own chart the way the worker does */
  tool(name: AnalysisToolName, args: Record<string, unknown>): ToolOutput {
    const output = ANALYSIS_RUNNERS[name](args, scriptContext(this.today, this.goalPace))
    if (!output.result.ok) throw new Error(`demo ${name}: ${output.result.error}`)
    this.parts.push({
      type: 'functionCall',
      durationMs: CALL_MS,
      name,
      args,
      result: { ...output.result, durationMs: CALL_MS }
    })
    const { columns, rows } = output.result
    if (columns && rows) {
      this.lastQuery = { ok: true, columns, rows, rowCount: rows.length, durationMs: CALL_MS }
      if (output.chart) this.chart(output.chart, 0)
    }
    return output
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

  chart(spec: ChartSpec, durationMs = CALL_MS): void {
    const prepared = prepareChart(spec, this.lastQuery)
    if (!prepared.ok) throw new Error(`demo chart "${spec.title}": ${prepared.error}`)
    this.parts.push({
      type: 'functionCall',
      durationMs,
      name: 'chart',
      args: spec,
      result: { ok: true },
      display: { data: prepared.data, currency: 'USD', series: prepared.series }
    })
  }
}

/** Run a script's turn with the chat tool's all-accounts views and goal tables in place. */
export function runChatScript(script: ChatScript, today: string): ChatMessagePart[] {
  const ddl = scopeViewsDdl({ accountId: null })
  // temp views shadow the real tables for unqualified names on this
  // connection, so they must be gone before any other code queries it
  const views = ddl.flatMap((s) => /^CREATE TEMP VIEW (\w+)/.exec(s)?.[1] ?? [])
  const goals = goalInputs(null)
  try {
    for (const statement of [...ddl, ...goalTableDdl()]) db.run(sql.raw(statement))
    for (const row of goals.rows.goals) db.run(bound(GOAL_INSERT_SQL, row))
    for (const row of goals.rows.history) db.run(bound(GOAL_HISTORY_INSERT_SQL, row))
    const turn = new Turn(today, goals.pace)
    script.answer(turn)
    return turn.parts
  } finally {
    for (const view of views) db.run(sql.raw(`DROP VIEW IF EXISTS temp.${view}`))
    db.run(sql.raw('DROP TABLE IF EXISTS temp.goals'))
    db.run(sql.raw('DROP TABLE IF EXISTS temp.goal_history'))
  }
}
