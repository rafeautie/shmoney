import { useMutation, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { Download01Icon } from '@hugeicons/core-free-icons'
import { LLM_MODEL } from '@shared/llm'
import { useLlmDownloadProgress, useLlmStatus } from '@/lib/llm'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Progress } from '@/components/ui/progress'

function formatBytes(bytes: number): string {
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`
}

/** Shown instead of the chat when the model isn't on disk yet. */
export function ChatModelGate() {
  const queryClient = useQueryClient()
  const status = useLlmStatus().data
  const progress = useLlmDownloadProgress()
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['llm'] })

  const download = useMutation({
    mutationFn: () => window.api.llm.download(),
    onSettled: invalidate
  })
  const cancelDownload = useMutation({
    mutationFn: () => window.api.llm.cancelDownload(),
    onSettled: invalidate
  })

  const stage = status?.stage ?? 'notDownloaded'

  return (
    <Empty className="flex-1 border-none">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon icon={Download01Icon} />
        </EmptyMedia>
        <EmptyTitle>Download the model to chat</EmptyTitle>
        <EmptyDescription>
          Chat runs on {LLM_MODEL.label}, the same on-device model behind auto-categorize. It
          downloads once and everything stays on this computer.
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
          <Button
            variant="outline"
            disabled={cancelDownload.isPending}
            onClick={() => cancelDownload.mutate()}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button disabled={download.isPending} onClick={() => download.mutate()}>
          {download.isPending ? 'Starting…' : stage === 'error' ? 'Retry download' : 'Download'}
        </Button>
      )}

      {stage === 'error' && status?.error && (
        <p className="max-w-sm text-xs text-destructive">{status.error}</p>
      )}
    </Empty>
  )
}
