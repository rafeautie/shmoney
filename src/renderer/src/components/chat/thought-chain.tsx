import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import {
  Analytics01Icon,
  ArrowRight01Icon,
  BrainIcon,
  Calculator01Icon,
  Calendar03Icon,
  DatabaseIcon,
  Loading03Icon
} from '@hugeicons/core-free-icons'
import {
  ACTION_TOOL_NAMES,
  ANALYSIS_TOOL_NAMES,
  type ActionToolName,
  type AnalysisToolName,
  type ChatMessagePart,
  type StreamingChatPart
} from '@shared/chat'
import { cn } from '@/lib/utils'
import { useLlmStatus } from '@/lib/llm'
import { PENDING_LABELS, actionToolLabel, analysisToolLabel } from '@/lib/chat-tools'
import { CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtStep
} from '@/components/ui/chain-of-thought'
import { ToolCallCard } from '@/components/chat/tool-call'
import { ChatChart } from '@/components/chat/chat-chart'
import { ProposalCard } from '@/components/chat/proposal-card'
import { TOOL_ICONS } from '@/components/chat/tool-icons'

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

/** in-flight label per tool */
const PENDING: Record<string, string> = {
  query: 'Writing query…',
  chart: 'Building chart…',
  calc: 'Calculating…',
  resolve_dates: 'Resolving dates…',
  ...PENDING_LABELS
}

type SettledCall = Extract<ChatMessagePart, { type: 'functionCall' }>
type AnalysisCall = Extract<SettledCall, { name: AnalysisToolName }>
type ActionCall = Extract<SettledCall, { name: ActionToolName }>

function isAnalysisCall(part: SettledCall): part is AnalysisCall {
  return (ANALYSIS_TOOL_NAMES as readonly string[]).includes(part.name)
}

function isActionCall(part: SettledCall): part is ActionCall {
  return (ACTION_TOOL_NAMES as readonly string[]).includes(part.name)
}

/**
 * One tool call's view, derived straight from its part — the label wording that
 * used to live in QueryCard/ChartCard, in one place now that the chain renders
 * every tool. Returns null for a shape this build doesn't know (e.g. a row
 * written before the formats merged); the chain drops it rather than guess.
 */
function describeTool(part: ToolPart): ToolView | null {
  // pending: the model is still writing this call's params
  if (part.result === undefined) {
    return {
      icon: TOOL_ICONS[part.name] ?? DatabaseIcon,
      label: PENDING[part.name] ?? 'Working…',
      active: true,
      failed: false
    }
  }
  if (isAnalysisCall(part)) {
    return {
      icon: TOOL_ICONS[part.name],
      label: analysisToolLabel(part.name, part.args, part.result),
      active: false,
      failed: !part.result.ok,
      input: part.args,
      output: part.result
    }
  }
  if (isActionCall(part)) {
    return {
      icon: TOOL_ICONS[part.name],
      label: actionToolLabel(part.result),
      active: false,
      failed: !part.result.ok,
      input: part.args,
      // the model saw only this summary; the card below shows the proposal itself
      output: part.result
    }
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
 * The approval card for a settled action call. Null when the proposal failed
 * (the chain shows why) or the part isn't an action call.
 */
function proposalDeliverable(
  part: ChainPart,
  target: { messageId: number; partIndex: number } | null
): ReactNode {
  if (part.type !== 'functionCall' || part.result === undefined || !isActionCall(part)) return null
  if (part.display == null) return null
  return <ProposalCard display={part.display} target={target} />
}

/** what the chain's one status line shows; a new key is a new step */
interface HeaderView {
  key: string
  icon: IconSvgElement
  label: string
  /** the step itself is in flight, so its timer runs */
  active: boolean
  /** the run is still going: the line stays dimmed and shimmering, finished steps included */
  live: boolean
  failed: boolean
  spin?: boolean
  toolCount?: number
}

/** the status line for a run: waiting, the in-flight step, or the settled summary */
function headerView(
  steps: StepView[],
  parts: ChainPart[],
  streaming: boolean,
  modelReady: boolean
): HeaderView | null {
  if (steps.length === 0) {
    if (!streaming) return null
    // the same key as a first reasoning step, so its timer carries on from here
    return modelReady
      ? {
          key: '0:Thinking…',
          icon: BrainIcon,
          label: 'Thinking…',
          active: true,
          live: true,
          failed: false
        }
      : {
          key: '0:Loading model…',
          icon: Loading03Icon,
          label: 'Loading model…',
          active: true,
          live: true,
          failed: false,
          spin: true
        }
  }
  if (streaming) {
    const last = steps[steps.length - 1]
    return {
      key: `${steps.length - 1}:${last.label}`,
      icon: last.kind === 'tool' ? last.icon : BrainIcon,
      label: last.label,
      active: last.active,
      live: true,
      failed: last.kind === 'tool' && last.failed
    }
  }
  const tools = steps.filter((s): s is Extract<StepView, { kind: 'tool' }> => s.kind === 'tool')
  return {
    key: 'summary',
    icon: BrainIcon,
    label: `Thought for ${formatThoughtDuration(parts.reduce((sum, p) => sum + stepDurationMs(p), 0))}`,
    active: false,
    live: false,
    // the run's last tool call, for the failed-at-a-glance signal
    failed: tools[tools.length - 1]?.failed ?? false,
    toolCount: tools.length
  }
}

type ShownHeader = HeaderView & { startedAt: number }

/** a label stays up at least this long, so quick tool calls don't flicker past */
const MIN_DWELL_MS = 1000

/**
 * The header view to draw: switches to a new key no sooner than MIN_DWELL_MS
 * after the last switch, skipping steps that came and went meanwhile. The
 * start time is when the step began, not when it got its turn on screen, so
 * the elapsed timer stays honest.
 */
function useDwellingHeader(target: HeaderView | null): ShownHeader | null {
  const [shown, setShown] = useState(() => target && { ...target, startedAt: Date.now() })
  const latest = useRef(target)
  const shownAt = useRef(0)
  useEffect(() => {
    latest.current = target
  })
  const key = target?.key
  useEffect(() => {
    if (key === undefined) return
    const startedAt = Date.now()
    const wait = Math.max(0, MIN_DWELL_MS - (startedAt - shownAt.current))
    const timer = setTimeout(() => {
      const next = latest.current
      if (!next || next.key !== key) return
      shownAt.current = Date.now()
      setShown((prev) => (prev?.key === key ? prev : { ...next, startedAt }))
    }, wait)
    return () => clearTimeout(timer)
  }, [key])
  if (!target || !shown) return null
  // same step: take its live fields (a call can fail in place) but keep the start
  return shown.key === target.key ? { ...target, startedAt: shown.startedAt } : shown
}

/**
 * Wall-clock ms, ticking only while a live timer needs it. A new step reads
 * the clock at once: after an idle stretch the last tick is stale, and the
 * timer would jump when it caught up.
 */
function useNow(ticking: boolean, step: string | undefined) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!ticking) return
    const tick = () => setNow(Date.now())
    const first = setTimeout(tick, 0)
    const id = setInterval(tick, 250)
    return () => {
      clearTimeout(first)
      clearInterval(id)
    }
  }, [ticking, step])
  return now
}

/**
 * One of two suffixes sharing a slot: the shown one sits in flow (so the line's
 * width eases to it), the other overlays it absolutely while it fades out.
 */
function Suffix({
  shown,
  className,
  children
}: {
  shown: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <span
      aria-hidden={!shown}
      className={cn(
        'transition-[opacity,filter] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
        !shown && 'absolute top-0 left-0 opacity-0 blur-[2px]',
        className
      )}
    >
      {children}
    </span>
  )
}

/**
 * One step's line: icon and label. An in-flight step's trailing ellipsis gives
 * way to its timer once it has run a second, crossfading in the same slot.
 */
function HeaderLabel({ view, now }: { view: ShownHeader; now: number }) {
  const elapsedMs = now - view.startedAt
  const pending = view.active && view.label.endsWith('…')
  const showTimer = pending && elapsedMs >= 1000
  const calls = view.toolCount ? ` · ${view.toolCount} call${view.toolCount === 1 ? '' : 's'}` : ''
  return (
    <>
      <HugeiconsIcon
        icon={view.icon}
        strokeWidth={2}
        className={cn('size-3.5 shrink-0', view.spin && 'animate-spin')}
      />
      <span>
        {pending ? view.label.slice(0, -1) : view.label + calls}
        {pending && (
          <span className="relative">
            <Suffix shown={!showTimer}>…</Suffix>
            <Suffix shown={showTimer} className="tabular-nums whitespace-pre">
              {` · ${formatThoughtDuration(Math.max(elapsedMs, 1000))}`}
            </Suffix>
          </span>
        )}
      </span>
    </>
  )
}

const LAYER = 'flex w-max items-center gap-1.5 whitespace-nowrap [grid-area:1/1]'

/**
 * The status line's text. A new step crossfades in place over the old one,
 * stacked in the same grid cell so nothing moves, while the line's width eases
 * to the new label so the chevron glides rather than jumps. The shimmer spans
 * the whole line for as long as the run is live, finished steps included, so
 * it never restarts or flickers between steps; it fades out only when the line
 * becomes the settled summary, and its mask comes off once that fade is over,
 * so settled lines carry no running animation.
 */
function StatusLine({ view, now }: { view: ShownHeader; now: number }) {
  const [initialKey] = useState(view.key)
  const [current, setCurrent] = useState(view)
  const [leaving, setLeaving] = useState<{ view: ShownHeader; now: number }[]>([])
  const [shimmering, setShimmering] = useState(view.live)
  const [width, setWidth] = useState<number>()
  if (view.key !== current.key) {
    setLeaving((prev) => [...prev, { view: current, now }])
    setCurrent(view)
  }
  if (view.live && !shimmering) setShimmering(true)
  // a timer, not transitionend: a fade that runs while the window is hidden
  // never reports its end, and the mask would stay on for good
  useEffect(() => {
    if (view.live || !shimmering) return
    const timer = setTimeout(() => setShimmering(false), 400)
    return () => clearTimeout(timer)
  }, [view.live, shimmering])

  const measure = useCallback((el: HTMLSpanElement | null) => {
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.borderBoxSize[0].inlineSize))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <span
      className={cn(
        'grid justify-items-start overflow-hidden transition-[width,--shimmer-dim] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
        shimmering && 'animate-shimmer',
        !view.live && '[--shimmer-dim:100%]'
      )}
      style={{ width }}
    >
      {leaving.map((layer) => (
        <span
          key={layer.view.key}
          aria-hidden
          className={cn(LAYER, 'animate-label-out')}
          onAnimationEnd={(e) => {
            if (e.target === e.currentTarget)
              setLeaving((prev) => prev.filter((other) => other !== layer))
          }}
        >
          <HeaderLabel view={layer.view} now={layer.now} />
        </span>
      ))}
      <span
        key={view.key}
        ref={measure}
        className={cn(LAYER, view.key !== initialKey && 'animate-label-in')}
      >
        <HeaderLabel view={view} now={now} />
      </span>
    </span>
  )
}

/**
 * A turn's chain of thought as one collapsible, and the turn's one status line
 * from send to settle. Before anything streams it stands in as the waiting
 * state ("Loading model…", "Thinking…"); while the run is live it tracks the
 * in-flight step with a per-step elapsed timer, crossfading each new step; once
 * the run settles it becomes a summary of the whole section: how long it took
 * (thinking and tool calls alike) and how many calls ran, e.g. "Thought for 6s
 * · 3 calls". Expanded it lays every step on a rail: thoughts as quote-bar
 * text, tool calls as an icon beside their own expandable input/output card.
 * The user's toggle always wins. Chart and proposal deliverables follow the
 * chain, still visible when it's collapsed, since a chart or a change to
 * approve is the answer, not a step.
 */
export function ThoughtChain({
  parts,
  streaming = false,
  asOf,
  messageId,
  startIndex = 0
}: {
  parts: ChainPart[]
  /** true only for the live, still-growing run of a streaming turn */
  streaming?: boolean
  asOf?: number
  /** the settled message these parts belong to; absent while the turn streams, so proposals can't be acted on yet */
  messageId?: number
  /** index of parts[0] in the message's parts, to address a proposal */
  startIndex?: number
}) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const open = userOpen ?? false
  // before the first chunk the model counts as loading whenever it isn't
  // confirmed in memory: the 'loading' push lands a beat after the turn starts
  const modelReady = useLlmStatus().data?.runtime === 'ready'

  const steps = parts.map(toStepView).filter((s): s is StepView => s !== null)
  const header = useDwellingHeader(headerView(steps, parts, streaming, modelReady))
  const now = useNow(header?.active ?? false, header?.key)
  if (!header) return null

  return (
    <>
      <ChainOfThought open={open} onOpenChange={setUserOpen} disabled={steps.length === 0}>
        <CollapsibleTrigger
          className={cn(
            'group/cot flex w-fit items-center gap-1.5 text-xs text-muted-foreground not-disabled:hover:text-foreground',
            header.failed && 'text-destructive not-disabled:hover:text-destructive'
          )}
        >
          <StatusLine view={header} now={now} />
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            strokeWidth={2}
            className={cn(
              '-ml-0.5 size-3.5 transition-[rotate,opacity] duration-200 ease-out group-data-panel-open/cot:rotate-90 motion-reduce:transition-none',
              steps.length === 0 && 'opacity-0'
            )}
          />
        </CollapsibleTrigger>
        <ChainOfThoughtContent>
          {steps.map((step, i) =>
            step.kind === 'reasoning' ? (
              // no icon: the header's brain stands for the thought, and the rail
              // runs beside its text as a quote bar (see ChainOfThoughtStep)
              <ChainOfThoughtStep key={i} status={step.active ? 'active' : 'complete'}>
                <div className="text-xs/relaxed whitespace-pre-wrap text-muted-foreground select-text">
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
        const deliverable =
          chartDeliverable(part, asOf) ??
          proposalDeliverable(
            part,
            messageId === undefined ? null : { messageId, partIndex: startIndex + i }
          )
        return deliverable && <Fragment key={i}>{deliverable}</Fragment>
      })}
    </>
  )
}
