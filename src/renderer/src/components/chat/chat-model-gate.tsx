import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon, Download01Icon } from '@hugeicons/core-free-icons'
import { LLM_MODELS } from '@shared/llm'
import {
  useLlmDownloadProgress,
  useLlmStatus,
  useLlmSupported,
  useModelActions,
  useModelState,
  useSelectedModel
} from '@/lib/llm'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Progress } from '@/components/ui/progress'

function formatBytes(bytes: number): string {
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`
}

/** Shown instead of the chat when the model isn't on disk yet. */
export function ChatModelGate() {
  const supported = useLlmSupported()
  const selected = useSelectedModel()
  const model = LLM_MODELS[selected]
  const status = useLlmStatus().data
  const stage = useModelState(selected).stage
  const progress = useLlmDownloadProgress()[selected]
  const actions = useModelActions()

  // an unsupported machine can't run any model, so there's nothing to download
  // and no download UI makes sense here
  if (!supported) {
    return (
      <Empty className="flex-1 border-none">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={Alert02Icon} />
          </EmptyMedia>
          <EmptyTitle>Chat isn&apos;t available on this device</EmptyTitle>
          <EmptyDescription>
            This computer doesn&apos;t have enough memory to run the on-device model chat needs.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <Empty className="flex-1 border-none">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon icon={Download01Icon} />
        </EmptyMedia>
        <EmptyTitle>Download the model to chat</EmptyTitle>
        <EmptyDescription>
          Chat runs on {model.label}, the same on-device model behind auto-categorize. It downloads
          once and everything stays on this computer.
        </EmptyDescription>
      </EmptyHeader>

      {stage === 'downloading' || stage === 'verifying' ? (
        <div className="w-full max-w-xs space-y-1.5">
          <Progress
            value={
              stage === 'verifying'
                ? 100
                : progress && progress.totalBytes > 0
                  ? (progress.downloadedBytes / progress.totalBytes) * 100
                  : 0
            }
          />
          <p className="text-xs text-muted-foreground">
            {stage === 'verifying'
              ? 'Verifying file integrity…'
              : progress
                ? `${formatBytes(progress.downloadedBytes)} / ${formatBytes(progress.totalBytes)}`
                : 'Starting download…'}
          </p>
          {stage === 'downloading' && (
            // verification can't be cancelled (the download record is already
            // gone), so only offer Cancel while bytes are still transferring
            <Button
              variant="outline"
              disabled={actions.cancelDownload.isPending}
              onClick={() => actions.cancelDownload.mutate(selected)}
            >
              Cancel
            </Button>
          )}
        </div>
      ) : (
        <Button
          disabled={actions.download.isPending}
          onClick={() => actions.download.mutate(selected)}
        >
          {actions.download.isPending
            ? 'Starting…'
            : stage === 'error'
              ? 'Retry download'
              : 'Download'}
        </Button>
      )}

      {stage === 'error' && status?.models[selected].error && (
        <p className="max-w-sm text-xs text-destructive">{status.models[selected].error}</p>
      )}
    </Empty>
  )
}
