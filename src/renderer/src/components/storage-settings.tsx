import { useLayoutEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

// Fixed table→bucket→color mapping so a bucket keeps its color no matter how
// sizes shift. The bucket order is also the display order; adjacent-color
// contrast was validated for the full sequence (blue/amber/emerald/violet/teal,
// then the slate "Other" and rose LLM segments appended below).
const BUCKETS = [
  { label: 'Transactions', tables: ['transactions'], color: 'var(--chart-1)' },
  { label: 'Accounts', tables: ['connections', 'accounts', 'holdings'], color: 'var(--chart-2)' },
  {
    label: 'Categories & rules',
    tables: ['category_groups', 'categories', 'rules', 'rule_suggestions'],
    color: 'var(--chart-3)'
  },
  { label: 'Activity log', tables: ['action_log'], color: 'var(--chart-5)' },
  { label: 'Chat', tables: ['conversations', 'chat_messages'], color: 'var(--chart-6)' }
]
// low-chroma slate so the remainder reads as background, not a series
const OTHER_COLOR = 'var(--chart-10)'
const LLM_COLOR = 'var(--chart-4)'

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1_000))} KB`
}

function formatShare(bytes: number, totalBytes: number): string {
  const pct = (bytes / totalBytes) * 100
  if (pct <= 0) return '0%'
  if (pct >= 100) return '100%'
  // a partial share must never display as exactly 0% or 100%, so add decimal
  // places until the rounded value stays inside the open interval
  for (let decimals = 0; decimals <= 4; decimals++) {
    const rounded = pct.toFixed(decimals)
    if (Number(rounded) > 0 && Number(rounded) < 100) return `${rounded}%`
  }
  return pct < 50 ? '<0.0001%' : '>99.9999%'
}

export function StorageSettings() {
  const size = useQuery({
    queryKey: ['storage', 'databaseSize'],
    queryFn: () => window.api.storage.getDatabaseSize()
  })
  // same key as the Local LLM card, so model downloads/deletes refresh this too
  const llmSize = useQuery({
    queryKey: ['llm', 'diskSize'],
    queryFn: () => window.api.llm.getDiskSize()
  })

  const barRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  // hovered segment index plus the cursor x relative to the bar
  const [hover, setHover] = useState<{ index: number; x: number } | null>(null)

  // center the tooltip on the cursor, clamped so it never leaves the bar
  useLayoutEffect(() => {
    const tip = tipRef.current
    const bar = barRef.current
    if (!tip || !bar || !hover) return
    const half = tip.offsetWidth / 2
    tip.style.left = `${Math.min(Math.max(hover.x, half), bar.clientWidth - half) - half}px`
  }, [hover])

  // hover is positional (nearest segment to the cursor) rather than per-segment
  // enter/leave, so the 2px gaps and fast drags across sliver segments never miss
  const onPointerMove = (e: React.PointerEvent): void => {
    const bar = barRef.current
    if (!bar) return
    let index = 0
    let bestDist = Infinity
    ;[...bar.children].forEach((el, i) => {
      const r = el.getBoundingClientRect()
      const dist = Math.max(r.left - e.clientX, e.clientX - r.right, 0)
      if (dist < bestDist) {
        bestDist = dist
        index = i
      }
    })
    setHover({ index, x: e.clientX - bar.getBoundingClientRect().left })
  }

  const data = llmSize.isPending ? undefined : size.data
  const llmBytes = llmSize.data ?? 0
  let segments: { label: string; bytes: number; color: string }[] = []
  if (data) {
    const byTable = new Map(data.tables.map((t) => [t.name, t.bytes]))
    segments = BUCKETS.map((bucket) => ({
      label: bucket.label,
      bytes: bucket.tables.reduce((sum, table) => sum + (byTable.get(table) ?? 0), 0),
      color: bucket.color
    }))
    // whatever the buckets don't cover: reports, saved filters, settings,
    // SQLite bookkeeping, free pages, and the write-ahead log
    const bucketed = segments.reduce((sum, s) => sum + s.bytes, 0)
    segments.push({
      label: 'Other',
      bytes: Math.max(0, data.totalBytes - bucketed),
      color: OTHER_COLOR
    })
    if (llmBytes > 0) segments.push({ label: 'Local LLM', bytes: llmBytes, color: LLM_COLOR })
    segments = segments.filter((s) => s.bytes > 0)
  }
  const totalBytes = (data?.totalBytes ?? 0) + llmBytes

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Storage</CardTitle>
        <CardDescription>
          {llmBytes > 0
            ? 'Your data lives in one SQLite database file on this device, alongside the downloaded local LLM.'
            : 'All your data lives in one SQLite database file on this device.'}
        </CardDescription>
      </CardHeader>
      {data && (
        <CardContent className="space-y-3">
          <p className="text-2xl font-semibold tabular-nums">{formatBytes(totalBytes)}</p>
          <div className="relative">
            <div ref={barRef} className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
              {segments.map((s, i) => (
                <div
                  key={s.label}
                  className="min-w-1 transition-opacity"
                  style={{
                    flexGrow: s.bytes,
                    backgroundColor: s.color,
                    opacity: hover && hover.index !== i ? 0.55 : 1
                  }}
                />
              ))}
            </div>
            {/* invisible hit band taller than the thin bar */}
            <div
              className="absolute inset-x-0 -inset-y-2"
              onPointerMove={onPointerMove}
              onPointerLeave={() => setHover(null)}
            />
            {hover && (
              <div
                ref={tipRef}
                className="pointer-events-none absolute bottom-full z-50 mb-1.5 w-max rounded-md bg-foreground px-3 py-1.5 text-xs text-background"
              >
                {segments[hover.index].label} · {formatBytes(segments[hover.index].bytes)} (
                {formatShare(segments[hover.index].bytes, totalBytes)})
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {segments.map((s) => (
              <span key={s.label} className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ backgroundColor: s.color }} />
                {s.label}
                <span className="text-muted-foreground tabular-nums">{formatBytes(s.bytes)}</span>
              </span>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  )
}
