import { useMemo } from 'react'
import { format, subDays } from 'date-fns'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import { DashboardSpeed01Icon } from '@hugeicons/core-free-icons'
import {
  LLM_FEATURE_LABELS,
  LLM_FEATURES,
  LLM_USAGE_DAILY_DAYS,
  generationRates,
  type LlmUsageSummary,
  type LlmUsageTotals
} from '@shared/llm'
import { Button } from '@/components/ui/button'
import { Chart, type FormatValue } from '@/components/charts/chart'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { useLlmUsage } from '@/lib/llm'
import { formatCompactTokens, formatElapsed, formatTps, modelLabel } from '@/lib/llm-stats'
import { useSettings } from '@/lib/settings'
import { plural } from '@/lib/utils'
import { SettingsSection } from './settings-controls'

const DASH = '–'

function averages(t: LlmUsageTotals) {
  const { decodeTps, prefillTps } = generationRates(t)
  return {
    decodeTps,
    prefillTps,
    ttftMs: t.ttftCount > 0 ? t.ttftMs / t.ttftCount : null,
    loadMs: t.loads > 0 ? t.loadMs / t.loads : null
  }
}

const tps = (value: number | null): string => (value === null ? DASH : formatTps(value))
const elapsed = (value: number | null): string => (value === null ? DASH : formatElapsed(value))

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tracking-tight tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

function Overview({ totals }: { totals: LlmUsageTotals }) {
  const avg = averages(totals)
  const outcomes = [
    totals.interrupted > 0 && `${totals.interrupted} stopped`,
    totals.errors > 0 && `${totals.errors} failed`
  ].filter(Boolean)
  return (
    <div className="grid grid-cols-3 gap-3">
      <Tile
        label="Requests"
        value={totals.requests.toLocaleString()}
        sub={outcomes.length ? outcomes.join(' · ') : undefined}
      />
      <Tile
        label="Tokens generated"
        value={totals.outputTokens.toLocaleString()}
        sub={`${formatCompactTokens(totals.inputTokens)} prompt tokens read`}
      />
      <Tile label="Compute time" value={formatElapsed(totals.totalMs)} />
      <Tile label="Generation speed" value={tps(avg.decodeTps)} sub="average while writing" />
      <Tile label="Prompt speed" value={tps(avg.prefillTps)} sub="average while reading" />
      <Tile label="First token" value={elapsed(avg.ttftMs)} sub="average wait" />
    </div>
  )
}

const formatTokens: FormatValue = (value, opts) =>
  opts?.compact ? formatCompactTokens(value) : plural(value, 'token')

/** the last LLM_USAGE_DAILY_DAYS days, oldest first, with days without usage at zero */
function useDailyRows(daily: LlmUsageSummary['daily']) {
  return useMemo(() => {
    const byDay = new Map<string, Record<string, string | number>>()
    const today = new Date()
    for (let i = LLM_USAGE_DAILY_DAYS - 1; i >= 0; i--) {
      const day = format(subDays(today, i), 'yyyy-MM-dd')
      byDay.set(day, { day, ...Object.fromEntries(LLM_FEATURES.map((f) => [f, 0])) })
    }
    for (const { day, feature, tokens } of daily) {
      const row = byDay.get(day)
      if (row) row[feature] = tokens
    }
    return [...byDay.values()]
  }, [daily])
}

function Activity({ daily }: { daily: LlmUsageSummary['daily'] }) {
  const rows = useDailyRows(daily)
  const used = new Set(daily.map((d) => d.feature))
  const series = LLM_FEATURES.filter((f) => used.has(f)).map((f) => ({
    key: f,
    label: LLM_FEATURE_LABELS[f]
  }))
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Tokens processed per day, last {LLM_USAGE_DAILY_DAYS} days
      </p>
      <Chart
        kind="bar"
        data={rows}
        xKey="day"
        series={series}
        stacked
        legend="auto"
        sensitive={false}
        formatValue={formatTokens}
        formatLabel={(day) => format(new Date(`${day}T12:00:00`), 'MMM d')}
        className="aspect-auto h-44 w-full"
      />
    </div>
  )
}

function ByModel({ rows }: { rows: LlmUsageSummary['byModel'] }) {
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Model</TableHead>
            <TableHead className="text-right">Requests</TableHead>
            <TableHead className="text-right">Generation</TableHead>
            <TableHead className="text-right">Prompt</TableHead>
            <TableHead className="text-right">First token</TableHead>
            <TableHead className="text-right">Load</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const avg = averages(row)
            return (
              <TableRow key={row.modelId} className="tabular-nums">
                <TableCell>{modelLabel(row.modelId)}</TableCell>
                <TableCell className="text-right">{row.requests.toLocaleString()}</TableCell>
                <TableCell className="text-right">{tps(avg.decodeTps)}</TableCell>
                <TableCell className="text-right">{tps(avg.prefillTps)}</TableCell>
                <TableCell className="text-right">{elapsed(avg.ttftMs)}</TableCell>
                <TableCell className="text-right">{elapsed(avg.loadMs)}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function ByFeature({ rows }: { rows: LlmUsageSummary['byFeature'] }) {
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Feature</TableHead>
            <TableHead className="text-right">Requests</TableHead>
            <TableHead className="text-right">Prompt tokens</TableHead>
            <TableHead className="text-right">Generated</TableHead>
            <TableHead className="text-right">Compute time</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.feature} className="tabular-nums">
              <TableCell>{LLM_FEATURE_LABELS[row.feature] ?? row.feature}</TableCell>
              <TableCell className="text-right">{row.requests.toLocaleString()}</TableCell>
              <TableCell className="text-right">{row.inputTokens.toLocaleString()}</TableCell>
              <TableCell className="text-right">{row.outputTokens.toLocaleString()}</TableCell>
              <TableCell className="text-right">{formatElapsed(row.totalMs)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/**
 * Settings section summarizing every request the on-device model has served:
 * totals, daily activity, and speed per model and feature. Reset is soft: it
 * moves the llmUsageSince setting (the log itself is never deleted), so Undo
 * just puts the previous value back.
 */
export function LlmUsageSettings(): React.JSX.Element {
  const { settings, setSetting } = useSettings()
  const since = settings.llmUsageSince
  const { data: usage } = useLlmUsage(since)
  const empty = usage !== undefined && usage.totals.requests === 0

  const reset = (): void => {
    setSetting('llmUsageSince', Date.now())
    toast('AI usage statistics reset', {
      action: { label: 'Undo', onClick: () => setSetting('llmUsageSince', since) }
    })
  }

  const countedFrom = usage?.firstAt ?? since
  return (
    <>
      <SettingsSection
        title="AI usage"
        description={
          <>
            How much work the on-device model has done and how fast it runs on this device. Counts
            chat, auto-categorize and rule suggestions
            {countedFrom !== null && <>, since {format(new Date(countedFrom), 'MMM d, yyyy')}</>}.
          </>
        }
        action={
          !empty &&
          usage && (
            <Button variant="outline" onClick={reset}>
              Reset statistics
            </Button>
          )
        }
      >
        {empty ? (
          <Empty className="border border-muted-foreground/30 bg-background">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={DashboardSpeed01Icon} />
              </EmptyMedia>
              <EmptyTitle>No AI usage yet</EmptyTitle>
              <EmptyDescription>
                Chat with your finances or auto-categorize transactions, and the model&apos;s speed
                and token counts show up here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          usage && (
            <div className="space-y-6">
              <Overview totals={usage.totals} />
              <Activity daily={usage.daily} />
            </div>
          )
        )}
      </SettingsSection>
      {usage && !empty && (
        <>
          <SettingsSection
            title="By model"
            description="Average speeds for each model you've used, measured on this device."
          >
            <ByModel rows={usage.byModel} />
          </SettingsSection>
          <SettingsSection title="By feature">
            <ByFeature rows={usage.byFeature} />
          </SettingsSection>
        </>
      )}
    </>
  )
}
