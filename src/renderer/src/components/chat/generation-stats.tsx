import type { ReactNode } from 'react'
import { generationRates, type GenerationStats } from '@shared/llm'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import {
  STOP_REASON_LABELS,
  formatCompactTokens,
  formatElapsed,
  formatTps,
  modelLabel
} from '@/lib/llm-stats'
import { plural } from '@/lib/utils'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right tabular-nums">{children}</dd>
    </>
  )
}

/**
 * A reply's generation stats as one muted footer line (speed and tokens),
 * with the full breakdown on hover. The same line ticks from live
 * snapshots while the reply streams and reads from the persisted stats after.
 */
export function GenerationStatsLine({ stats }: { stats: GenerationStats }) {
  if (stats.outputTokens === 0) return null
  const { decodeTps, prefillTps } = generationRates(stats)
  const summary = [
    decodeTps !== null && formatTps(decodeTps),
    plural(stats.outputTokens, 'token')
  ].filter(Boolean)

  return (
    <HoverCard>
      <HoverCardTrigger
        render={<span tabIndex={0} />}
        className="cursor-default tabular-nums outline-none focus-visible:underline dark:text-muted-foreground/70"
      >
        {summary.join(' · ')}
      </HoverCardTrigger>
      <HoverCardContent side="top" align="start" className="w-64">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <Row label="Model">{modelLabel(stats.modelId)}</Row>
          <Row label="Generated">
            {stats.outputTokens.toLocaleString()} tokens
            {decodeTps !== null && ` · ${formatTps(decodeTps)}`}
          </Row>
          <Row label="Prompt">
            {stats.inputTokens.toLocaleString()} tokens
            {prefillTps !== null && ` · ${formatTps(prefillTps)}`}
          </Row>
          {stats.ttftMs !== null && <Row label="First token">{formatElapsed(stats.ttftMs)}</Row>}
          <Row label="Context">
            {formatCompactTokens(stats.contextTokens)} / {formatCompactTokens(stats.contextSize)}
          </Row>
          {stats.toolMs > 0 && <Row label="Tools">{formatElapsed(stats.toolMs)}</Row>}
          {stats.loadMs !== null && <Row label="Model load">{formatElapsed(stats.loadMs)}</Row>}
          <Row label="Total">{formatElapsed(stats.totalMs)}</Row>
          {stats.stopReason !== null && (
            <Row label="Outcome">{STOP_REASON_LABELS[stats.stopReason]}</Row>
          )}
        </dl>
      </HoverCardContent>
    </HoverCard>
  )
}
