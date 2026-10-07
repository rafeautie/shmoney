import { useLayoutEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Backup, BackupKind } from '@shared/storage'
import { Button } from '@/components/ui/button'
import { ConfirmButton } from '@/components/confirm-dialog'
import { isDemo } from '@/lib/platform'
import { useSettingsDialog } from '@/lib/settings-dialog'
import { ipcErrorMessage } from '@/lib/utils'
import { SettingAction, SettingsGroup, SettingsSection, SettingsSubpage } from './settings-controls'

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

function DatabaseUsage() {
  const size = useQuery({
    queryKey: ['storage', 'databaseSize'],
    queryFn: () => window.api.storage.getDatabaseSize()
  })
  // under the shared 'llm' key, so model downloads/deletes refresh this too
  const llmSize = useQuery({
    queryKey: ['llm', 'diskSizes'],
    queryFn: () => window.api.llm.getDiskSizes()
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
  // several models can be on disk at once; the LLM segment is their combined size
  const llmBytes = llmSize.data
    ? Object.values(llmSize.data).reduce((sum: number, bytes) => sum + (bytes ?? 0), 0)
    : 0
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
    <SettingsSection
      title="Storage"
      description={
        llmBytes > 0
          ? 'Your data lives in one SQLite database file on this device, alongside the downloaded local LLM.'
          : 'All your data lives in one SQLite database file on this device.'
      }
    >
      {data && (
        <div className="space-y-3">
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
        </div>
      )}
    </SettingsSection>
  )
}

const BACKUPS_KEY = ['storage', 'backups']

const KIND_LABELS: Record<BackupKind, string> = {
  daily: 'Daily',
  'pre-migration': 'Before an update',
  manual: 'Backed up by you',
  'pre-restore': 'Before a restore'
}

const formatWhen = (ms: number): string =>
  new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function BackupsSection() {
  const queryClient = useQueryClient()
  const { open } = useSettingsDialog()
  const backups = useQuery({
    queryKey: BACKUPS_KEY,
    queryFn: () => window.api.storage.listBackups()
  })
  const backupNow = useMutation({
    mutationFn: () => window.api.storage.backupNow(),
    onSuccess: () => toast('Backup saved'),
    onError: (error) => toast.error(ipcErrorMessage(error)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: BACKUPS_KEY })
  })
  const latest = backups.data?.[0]

  return (
    <SettingsSection
      title="Backups"
      description="shmoney snapshots your database every day and before an update changes it, keeping the last 7 days and one a week for the last 4 weeks."
    >
      <SettingsGroup>
        <SettingAction
          label="Back up now"
          description={latest ? `Last backup ${formatWhen(latest.createdAt)}` : 'No backups yet'}
        >
          <Button
            variant="outline"
            disabled={backupNow.isPending}
            onClick={() => backupNow.mutate()}
          >
            {backupNow.isPending ? 'Backing up…' : 'Back up now'}
          </Button>
        </SettingAction>
        <SettingAction label="Restore" description="Roll your data back to an earlier backup.">
          <Button
            variant="outline"
            disabled={!backups.data?.length}
            onClick={() => open('storage', 'backups')}
          >
            Choose backup
          </Button>
        </SettingAction>
        <SettingAction
          label="Backups folder"
          description="Copy backups somewhere else, like another drive, to keep them safe from this one."
        >
          <Button variant="outline" onClick={() => void window.api.storage.showBackupsFolder()}>
            Show in folder
          </Button>
        </SettingAction>
      </SettingsGroup>
    </SettingsSection>
  )
}

function ExportSection() {
  const exportAll = useMutation({
    mutationFn: () => window.api.storage.exportAll(),
    onSuccess: (result) => {
      if (!result) return
      toast('Export saved', {
        description: result.path,
        action: {
          label: 'Show in folder',
          onClick: () => void window.api.storage.showInFolder(result.path)
        }
      })
    },
    onError: (error) => toast.error(ipcErrorMessage(error))
  })

  return (
    <SettingsSection title="Export">
      <SettingsGroup>
        <SettingAction
          label="Export everything"
          description="One CSV file per table plus a copy of the database, saved to a folder you choose."
        >
          <Button
            variant="outline"
            disabled={exportAll.isPending}
            onClick={() => exportAll.mutate()}
          >
            {exportAll.isPending ? 'Exporting…' : 'Export'}
          </Button>
        </SettingAction>
      </SettingsGroup>
    </SettingsSection>
  )
}

function BackupRow({ backup }: { backup: Backup }) {
  const restore = useMutation({
    mutationFn: () => window.api.storage.restoreBackup(backup.name),
    onError: (error) => toast.error(ipcErrorMessage(error))
  })
  const when = formatWhen(backup.createdAt)

  return (
    <SettingAction
      label={when}
      description={`${KIND_LABELS[backup.kind]} · ${formatBytes(backup.bytes)}`}
    >
      <ConfirmButton
        variant="outline"
        title="Restore this backup?"
        description={`shmoney restarts with your data as it was on ${when}. What you have now is backed up first, so you can switch back.`}
        confirmLabel="Restore and restart"
        confirmVariant="default"
        pendingLabel="Restoring…"
        pending={restore.isPending}
        onConfirm={() => restore.mutate()}
      >
        Restore
      </ConfirmButton>
    </SettingAction>
  )
}

function BackupsPage({ onBack }: { onBack: () => void }) {
  const backups = useQuery({
    queryKey: BACKUPS_KEY,
    queryFn: () => window.api.storage.listBackups()
  })

  return (
    <SettingsSubpage
      parent="Storage"
      title="Restore a backup"
      description="Restoring replaces your current data with the backup’s and restarts shmoney."
      onBack={onBack}
    >
      {backups.data && backups.data.length > 0 ? (
        <SettingsGroup>
          {backups.data.map((backup) => (
            <BackupRow key={backup.name} backup={backup} />
          ))}
        </SettingsGroup>
      ) : (
        backups.data && <p className="text-xs text-muted-foreground">No backups yet.</p>
      )}
    </SettingsSubpage>
  )
}

export function StorageSettings() {
  const { page, open } = useSettingsDialog()
  if (page === 'backups') return <BackupsPage onBack={() => open('storage')} />

  return (
    <>
      <DatabaseUsage />
      {/* the demo's data lives in the page, with no file to copy */}
      {!isDemo && (
        <>
          <BackupsSection />
          <ExportSection />
        </>
      )}
    </>
  )
}
