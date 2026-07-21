import { Fragment, useState, type ReactNode } from 'react'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import {
  Analytics01Icon,
  ArrowRight01Icon,
  BrainIcon,
  Calculator01Icon,
  Calendar03Icon,
  DatabaseIcon
} from '@hugeicons/core-free-icons'
import type { StreamingChatPart } from '@shared/chat'
import { cn } from '@/lib/utils'
import { CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtStep
} from '@/components/ui/chain-of-thought'
import { ToolCallCard } from '@/components/chat/tool-call'
import { ChatChart } from '@/components/chat/chat-chart'

// A turn's chain of thought: its reasoning and tool calls as one collapsible
// timeline, so a turn that thinks, fires several queries and a chart reads as a
// single summarised step rather than a stack of cards and separate thought
// panels. Whatever the tools, and however the model interleaves thinking
// between them, it all lands on one rail. Only text (the answer) and the drawn
// charts live outside; the charts because a chart is the answer, not a step.

/** the parts a chain is built from: a run of consecutive reasoning + tool calls */
export type ChainPart = Extract<StreamingChatPart, { type: 'reasoning' } | { type: 'functionCall' }>
/** one functionCall part, pending (still being written) or settled */
type ToolPart = Extract<StreamingChatPart, { type: 'functionCall' }>

/** the transcript view of one tool call: what the rail, the summary and the card show */
interface ToolView {
  icon: IconSvgElement
  label: string
  /** the call is still being written or is executing */
  active: boolean
  failed: boolean
  input?: unknown
  output?: unknown
}

/** one step on the rail: a thought (quote bar) or a tool call (icon + card) */
type StepView =
  | { kind: 'reasoning'; active: boolean; label: string; text: string }
  | ({ kind: 'tool' } & ToolView)

/** "12s" or "1m 5s"; sub-second thoughts round up so the label never says 0s */
function formatThoughtDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

/** "8ms" or "1.2s"; queries are usually far quicker than thoughts */
function formatQueryDuration(ms: number): string {
  return ms < 1000 ? `${Math.max(1, Math.round(ms))}ms` : `${(ms / 1000).toFixed(1)}s`
}

/**
 * How long one step held the turn: a thought's reasoning segment, or a tool
 * call's open-to-settle span. Summed across the run, this is the "thinking
 * time" the collapsed summary reports — the whole section, tool calls included,
 * not only the reasoning. Pending steps and rows persisted before the call span
 * existed contribute nothing.
 */
function stepDurationMs(part: ChainPart): number {
  if (part.type === 'reasoning') return part.durationMs ?? 0
  return part.result === undefined ? 0 : (part.durationMs ?? 0)
}

/**
 * One tool call's view, derived straight from its part — the label wording that
 * used to live in QueryCard/ChartCard, in one place now that the chain renders
 * every tool. Returns null for a shape this build doesn't know (e.g. a row
 * written before the formats merged); the chain drops it rather than guess.
 */
/** icon and in-flight label per tool, the one place a tool name maps to chrome */
const PENDING: Record<string, { icon: IconSvgElement; label: string }> = {
  query: { icon: DatabaseIcon, label: 'Writing query…' },
  chart: { icon: Analytics01Icon, label: 'Building chart…' },
  calc: { icon: Calculator01Icon, label: 'Calculating…' },
  resolve_dates: { icon: Calendar03Icon, label: 'Resolving dates…' }
}

function describeTool(part: ToolPart): ToolView | null {
  // pending: the model is still writing this call's params
  if (part.result === undefined) {
    const pending = PENDING[part.name] ?? { icon: DatabaseIcon, label: 'Working…' }
    return { ...pending, active: true, failed: false }
  }
  if (part.name === 'query') {
    const { result } = part
    const rows = `${result.rowCount ?? 0}${result.truncated ? '+' : ''} row${result.rowCount === 1 ? '' : 's'}`
    return {
      icon: DatabaseIcon,
      label: result.ok
        ? `Queried database · ${rows} · ${formatQueryDuration(result.durationMs)}`
        : 'Query failed',
      active: false,
      failed: !result.ok,
      input: part.args.sql,
      output: result
    }
  }
  if (part.name === 'chart') {
    const drawn = part.result.ok === true && part.display != null
    return {
      icon: Analytics01Icon,
      label: drawn ? 'Built chart' : 'Chart failed',
      active: false,
      failed: !drawn,
      input: part.args,
      // the model never saw the chart data, only this tiny ack/error
      output: drawn ? { ok: true } : { ok: false, error: part.result.error ?? 'Chart failed.' }
    }
  }
  if (part.name === 'calc') {
    const { result } = part
    return {
      icon: Calculator01Icon,
      label: result.ok ? `Calculated · ${result.value}` : 'Calculation failed',
      active: false,
      failed: !result.ok,
      input: part.args.expression,
      output: result
    }
  }
  if (part.name === 'resolve_dates') {
    const { result } = part
    return {
      icon: Calendar03Icon,
      label: result.ok ? `Resolved dates · ${result.start} to ${result.end}` : 'Date lookup failed',
      active: false,
      failed: !result.ok,
      input: part.args,
      output: result
    }
  }
  return null
}

/** a part's step view, or null for an unknown tool shape (dropped from the rail) */
function toStepView(part: ChainPart): StepView | null {
  if (part.type === 'reasoning') {
    if (part.durationMs === null)
      return { kind: 'reasoning', active: true, label: 'Thinking…', text: part.text }
    return {
      kind: 'reasoning',
      active: false,
      label: `Thought for ${formatThoughtDuration(part.durationMs)}`,
      text: part.text
    }
  }
  const tool = describeTool(part)
  return tool && { kind: 'tool', ...tool }
}

/** the drawn chart for a settled chart call, or null when there's nothing to draw */
function chartDeliverable(part: ChainPart, asOf?: number): ReactNode {
  if (part.type !== 'functionCall' || part.result === undefined || part.name !== 'chart')
    return null
  const { args: spec, display, result } = part
  if (result.ok !== true || display == null) return null
  return (
    <ChatChart
      spec={spec}
      // parts persisted before the pivot existed carry no resolved series in
      // their JSON, so fall back to the spec's
      series={display.series ?? spec.series}
      data={display.data}
      currency={display.currency}
      asOf={asOf}
    />
  )
}

/**
 * A turn's chain of thought as one collapsible. While the run is live the
 * header tracks the in-flight step — the thought or tool call happening now —
 * so tool calls surface as they run. Once the run settles it collapses to a
 * summary of the whole section: how long it took (thinking and tool calls
 * alike) and how many calls ran, e.g. "Thought for 6s · 3 calls". Expanded it
 * lays every step on a rail: thoughts as quote-bar text, tool calls as an icon
 * beside their own expandable input/output card. The user's toggle always wins.
 * Chart deliverables follow the chain, still visible when it's collapsed, since
 * a chart is the answer, not a step.
 */
export function ThoughtChain({
  parts,
  streaming = false,
  asOf
}: {
  parts: ChainPart[]
  /** true only for the live, still-growing run of a streaming turn */
  streaming?: boolean
  asOf?: number
}) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const open = userOpen ?? false

  const steps = parts.map(toStepView).filter((s): s is StepView => s !== null)
  if (steps.length === 0) return null

  const toolCount = steps.filter((s) => s.kind === 'tool').length
  const last = steps[steps.length - 1]
  // the run's last tool call, for the failed-at-a-glance signal on the summary
  const lastTool = [...steps]
    .reverse()
    .find((s): s is Extract<StepView, { kind: 'tool' }> => s.kind === 'tool')

  // Live, the header mirrors the in-flight step (the current tool call or
  // thought); settled, it becomes the summary — one duration for the whole
  // section, tool time included, under the chain-of-thought brain.
  const headerLabel = streaming
    ? last.label
    : `Thought for ${formatThoughtDuration(parts.reduce((sum, p) => sum + stepDurationMs(p), 0))}`
  const headerIcon = streaming && last.kind === 'tool' ? last.icon : BrainIcon
  const headerActive = streaming && last.active
  const headerFailed = streaming ? last.kind === 'tool' && last.failed : (lastTool?.failed ?? false)

  return (
    <>
      <ChainOfThought open={open} onOpenChange={setUserOpen}>
        <CollapsibleTrigger
          className={cn(
            'group/cot flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground',
            headerActive && 'animate-shimmer',
            headerFailed && 'text-destructive hover:text-destructive'
          )}
        >
          <HugeiconsIcon icon={headerIcon} strokeWidth={2} className="size-3.5" />
          <span className="text-left">{headerLabel}</span>
          {/* the call count belongs to the settled summary; while streaming the
              header is tracking the in-flight step, not tallying */}
          {!streaming && toolCount > 0 && (
            <span className="opacity-70">
              · {toolCount} call{toolCount === 1 ? '' : 's'}
            </span>
          )}
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            strokeWidth={2}
            className="-ml-0.5 size-3.5 group-data-panel-open/cot:rotate-90"
          />
        </CollapsibleTrigger>
        <ChainOfThoughtContent>
          {steps.map((step, i) =>
            step.kind === 'reasoning' ? (
              // no icon: the header's brain stands for the thought, and the rail
              // runs beside its text as a quote bar (see ChainOfThoughtStep)
              <ChainOfThoughtStep key={i} status={step.active ? 'active' : 'complete'}>
                <div className="text-xs/relaxed whitespace-pre-wrap text-muted-foreground">
                  {step.text}
                </div>
              </ChainOfThoughtStep>
            ) : (
              <ChainOfThoughtStep
                key={i}
                icon={step.icon}
                status={step.active ? 'active' : 'complete'}
              >
                <ToolCallCard
                  label={step.label}
                  active={step.active}
                  failed={step.failed}
                  input={step.input}
                  output={step.output}
                />
              </ChainOfThoughtStep>
            )
          )}
        </ChainOfThoughtContent>
      </ChainOfThought>
      {parts.map((part, i) => {
        const chart = chartDeliverable(part, asOf)
        return chart && <Fragment key={i}>{chart}</Fragment>
      })}
    </>
  )
}
