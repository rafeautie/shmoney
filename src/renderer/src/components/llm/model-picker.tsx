import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import {
  LLM_MODELS,
  MODEL_FAMILIES,
  MODEL_IDS,
  modelComfortable,
  modelRunnable,
  type HardwareInfo,
  type LlmDownloadProgress,
  type LlmModel,
  type ModelFamily,
  type ModelId
} from '@shared/llm'
import {
  useHardware,
  useLlmDownloadProgress,
  useLlmSupported,
  useModelActions,
  useModelState,
  useRecommendedModel,
  useSelectedModel
} from '@/lib/llm'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { LlmStatusBadge } from './llm-status-badge'

function formatBytes(bytes: number): string {
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`
}

/**
 * The model chooser shared by Settings and onboarding. It reads live status
 * itself, so any surface can drop it in with no props. Models are grouped by
 * family, one slim row each: the recommended-for-this-hardware badge, a size
 * and fit hint, and its own download/cancel/delete control. Clicking a runnable
 * row makes it the selected (active) model; downloading a model selects it
 * too, so downloading is also choosing. Models the machine can't run fold
 * behind a toggle, and when nothing runs the picker leads with a warning that
 * AI features are off.
 */
export function ModelPicker({ className }: { className?: string }): React.JSX.Element {
  const supported = useLlmSupported()
  const selected = useSelectedModel()
  const recommended = useRecommendedModel()
  const hw = useHardware().data
  const progress = useLlmDownloadProgress()
  const actions = useModelActions()
  // one confirm dialog, reused across rows; holds the model pending deletion
  const [confirmDelete, setConfirmDelete] = useState<ModelId | null>(null)
  const [showAll, setShowAll] = useState(false)

  // models this machine can't run fold away, except the selected one so the
  // current choice never disappears; optimistic while hardware is loading
  const runnableHere = (id: ModelId): boolean => !hw || modelRunnable(LLM_MODELS[id], hw)
  const hiddenCount = MODEL_IDS.filter((id) => !runnableHere(id) && id !== selected).length
  const visible = (id: ModelId): boolean => showAll || runnableHere(id) || id === selected

  const families = (Object.keys(MODEL_FAMILIES) as ModelFamily[])
    .map((family) => ({
      family,
      ids: MODEL_IDS.filter((id) => LLM_MODELS[id].family === family && visible(id))
    }))
    .filter((group) => group.ids.length > 0)

  return (
    <div className={cn('space-y-4', className)}>
      {!supported && <UnsupportedWarning />}
      {families.map(({ family, ids }) => (
        <section key={family} className="space-y-1.5">
          <h3 className="text-xs font-medium text-muted-foreground">
            {MODEL_FAMILIES[family].label}
            <span className="font-normal text-muted-foreground/70">
              {' '}
              · {MODEL_FAMILIES[family].vendor}
            </span>
          </h3>
          <div
            role="radiogroup"
            aria-label={`${MODEL_FAMILIES[family].label} models`}
            className="divide-y overflow-hidden rounded-lg border"
          >
            {ids.map((id) => (
              <ModelRow
                key={id}
                model={LLM_MODELS[id]}
                selected={selected === id}
                recommended={recommended === id}
                hw={hw}
                progress={progress[id]}
                actions={actions}
                onDelete={() => setConfirmDelete(id)}
              />
            ))}
          </div>
        </section>
      ))}
      {hiddenCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 text-muted-foreground"
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll
            ? 'Hide models this device can’t run'
            : `Show ${hiddenCount} more that need more memory`}
        </Button>
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null)
        }}
        title={confirmDelete ? `Delete ${LLM_MODELS[confirmDelete].label}?` : ''}
        description="This removes the model file from this device to reclaim disk space. Auto features on this model stop until you download it again."
        pending={actions.deleteModel.isPending}
        pendingLabel="Deleting…"
        onConfirm={() => {
          if (confirmDelete) {
            actions.deleteModel.mutate(confirmDelete, { onSuccess: () => setConfirmDelete(null) })
          }
        }}
      />
    </div>
  )
}

function ModelRow({
  model,
  selected,
  recommended,
  hw,
  progress,
  actions,
  onDelete
}: {
  model: LlmModel
  selected: boolean
  recommended: boolean
  hw: HardwareInfo | undefined
  progress: LlmDownloadProgress | null
  actions: ReturnType<typeof useModelActions>
  onDelete: () => void
}): React.JSX.Element {
  const { stage, error } = useModelState(model.id)
  // optimistic while hardware is loading, so a row never flashes disabled
  const runnable = hw ? modelRunnable(model, hw) : true
  const comfortable = hw ? modelComfortable(model, hw) : true

  const downloading = stage === 'downloading'
  const verifying = stage === 'verifying'
  const isDownloaded = stage === 'downloaded'
  const errored = stage === 'error'

  const select = (): void => {
    if (runnable && !selected) actions.select.mutate(model.id)
  }
  // downloading a model also selects it: the one you download is the one you want
  const download = (): void => {
    if (!selected) actions.select.mutate(model.id)
    actions.download.mutate(model.id)
  }

  const percent = verifying
    ? 100
    : progress && progress.totalBytes > 0
      ? (progress.downloadedBytes / progress.totalBytes) * 100
      : 0

  return (
    <div
      role="radio"
      tabIndex={runnable ? 0 : -1}
      aria-checked={selected}
      aria-disabled={!runnable}
      aria-label={model.label}
      onClick={select}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && runnable) {
          e.preventDefault()
          select()
        }
      }}
      className={cn(
        'px-3 py-2 text-sm transition-colors outline-none focus-visible:bg-muted/60',
        runnable ? 'cursor-pointer' : 'cursor-not-allowed opacity-60',
        selected ? 'bg-primary/5' : runnable && 'hover:bg-muted/40'
      )}
    >
      <div className="flex min-h-7 items-center gap-3">
        <span
          aria-hidden
          className={cn(
            'flex size-4 shrink-0 items-center justify-center rounded-full border',
            selected
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-muted-foreground/40'
          )}
        >
          {selected && <HugeiconsIcon icon={Tick02Icon} size={11} strokeWidth={3} />}
        </span>
        <span className="w-9 shrink-0 font-medium text-foreground tabular-nums">
          {model.variant}
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {recommended && <Badge variant="default">Recommended</Badge>}
          {/* in-memory state only means anything for the active model */}
          {selected && isDownloaded && <LlmStatusBadge />}
        </div>

        {downloading || verifying ? (
          <div className="flex w-40 shrink-0 items-center gap-2">
            <Progress value={percent} className="flex-1" />
            <span className="w-16 text-right text-xs text-muted-foreground tabular-nums">
              {verifying ? 'Verifying' : progress ? `${Math.floor(percent)}%` : 'Starting'}
            </span>
          </div>
        ) : (
          <span className="shrink-0 text-xs text-muted-foreground">
            {sizeHint({ model, runnable, comfortable, isDownloaded })}
          </span>
        )}

        {/* actions sit outside the row's select handler; a fixed width keeps
            the size column aligned across rows */}
        <div
          className="flex w-20 shrink-0 justify-end"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {downloading && (
            <Button
              variant="ghost"
              size="sm"
              disabled={actions.cancelDownload.isPending}
              onClick={() => actions.cancelDownload.mutate(model.id)}
            >
              Cancel
            </Button>
          )}
          {(stage === 'notDownloaded' || errored) && runnable && (
            <Button
              variant={selected ? 'default' : 'outline'}
              size="sm"
              disabled={actions.download.isPending}
              onClick={download}
            >
              {errored ? 'Retry' : 'Download'}
            </Button>
          )}
          {isDownloaded && (
            <Button variant="ghost" size="sm" onClick={onDelete}>
              Delete
            </Button>
          )}
        </div>
      </div>

      {errored && error && <p className="mt-1 pl-7 text-xs text-destructive">{error}</p>}
    </div>
  )
}

// the muted size column: the model's footprint plus what running it on this
// machine means
function sizeHint({
  model,
  runnable,
  comfortable,
  isDownloaded
}: {
  model: LlmModel
  runnable: boolean
  comfortable: boolean
  isDownloaded: boolean
}): string {
  const size = formatBytes(model.downloadBytes)
  if (!runnable) return 'Needs more memory'
  if (isDownloaded) return `${size} on disk`
  return `${size} · ${comfortable ? 'runs well' : 'may be slow'}`
}

function UnsupportedWarning(): React.JSX.Element {
  return (
    <div className="flex gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
      <HugeiconsIcon
        icon={Alert02Icon}
        size={16}
        className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
      />
      <div className="space-y-0.5 text-sm">
        <p className="font-medium text-foreground">On-device AI is off on this device</p>
        <p className="text-muted-foreground">
          This computer doesn&apos;t have enough memory to run the local model, so auto-categorize
          and chat are turned off. They&apos;ll switch on automatically on a device that meets the
          minimum.
        </p>
      </div>
    </div>
  )
}
