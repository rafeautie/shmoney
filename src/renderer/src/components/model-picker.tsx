import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import {
  LLM_MODELS,
  MODEL_IDS,
  modelComfortable,
  modelRunnable,
  type HardwareInfo,
  type LlmDownloadProgress,
  type LlmModel,
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

function formatBytes(bytes: number): string {
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`
}

/**
 * The model chooser shared by Settings and onboarding. It reads live status
 * itself, so any surface can drop it in with no props. One row per model, each
 * showing the recommended-for-this-hardware badge, a capability hint, and its
 * own download/cancel/delete control. Clicking a runnable row makes it the
 * selected (active) model; downloading a model selects it too, so downloading
 * is also choosing. A model the machine can't run is disabled, and when nothing
 * runs the whole picker leads with a warning that AI features are off.
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

  return (
    <div className={cn('space-y-3', className)}>
      {!supported && <UnsupportedWarning />}
      <div className="space-y-2">
        {MODEL_IDS.map((id) => (
          <ModelOption
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

function ModelOption({
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

  return (
    <div
      role="button"
      tabIndex={runnable ? 0 : -1}
      aria-pressed={selected}
      aria-disabled={!runnable}
      onClick={select}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && runnable) {
          e.preventDefault()
          select()
        }
      }}
      className={cn(
        'rounded-lg border p-3 text-left transition-colors',
        runnable ? 'cursor-pointer' : 'cursor-not-allowed opacity-60',
        selected ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
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
            <span className="font-medium text-foreground">{model.label}</span>
            <Badge variant="secondary">{model.params}</Badge>
            {recommended && <Badge variant="default">Recommended</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">
            {capabilityHint({ model, runnable, comfortable, isDownloaded })}
          </p>
        </div>

        {/* actions sit outside the row's select handler */}
        <div className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {downloading && (
            <Button
              variant="outline"
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
            <Button variant="outline" size="sm" onClick={onDelete}>
              Delete
            </Button>
          )}
        </div>
      </div>

      {(downloading || verifying) && (
        <div className="mt-2.5 space-y-1.5">
          <Progress
            value={
              verifying
                ? 100
                : progress && progress.totalBytes > 0
                  ? (progress.downloadedBytes / progress.totalBytes) * 100
                  : 0
            }
          />
          <p className="text-xs text-muted-foreground">
            {verifying
              ? 'Verifying file integrity…'
              : progress
                ? `${formatBytes(progress.downloadedBytes)} / ${formatBytes(progress.totalBytes)}`
                : 'Starting download…'}
          </p>
        </div>
      )}

      {errored && error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  )
}

// one muted line under the name: what running this model on this machine means,
// plus its download/disk size
function capabilityHint({
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
  if (!runnable) return "Needs more memory than this device has, so it can't run here."
  if (isDownloaded) return `Downloaded · ${size} on disk.`
  const fit = comfortable ? 'runs well on this device' : 'may run slowly on this device'
  return `${size} download · ${fit}.`
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
