import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LLM_MODEL as MODEL } from '@shared/llm'
import { useLlmDownloadProgress, useLlmStatus } from '@/lib/llm'
import { ipcErrorMessage } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SettingsGroup, SettingAction } from './settings-controls'
import { ConfirmDialog } from './confirm-dialog'

function formatBytes(bytes: number): string {
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`
}

export function LlmSettings() {
  const queryClient = useQueryClient()
  const status = useLlmStatus().data
  const [confirmDelete, setConfirmDelete] = useState(false)

  const progress = useLlmDownloadProgress()
  const diskSize = useQuery({
    queryKey: ['llm', 'diskSize'],
    queryFn: () => window.api.llm.getDiskSize()
  })

  // refetch both status and on-disk size after any model action
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['llm'] })

  const download = useMutation({
    mutationFn: () => window.api.llm.download(),
    onSettled: invalidate
  })
  const cancelDownload = useMutation({
    mutationFn: () => window.api.llm.cancelDownload(),
    onSettled: invalidate
  })
  const deleteModel = useMutation({
    mutationFn: () => window.api.llm.deleteModel(),
    onSuccess: () => {
      setConfirmDelete(false)
    },
    onSettled: invalidate
  })

  const stage = status?.stage ?? 'notDownloaded'
  // loading/ready both mean the file is on disk and can be deleted
  const isDownloaded = stage === 'downloaded' || stage === 'loading' || stage === 'ready'

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Local LLM</CardTitle>
        <CardDescription>
          {MODEL.label}. Downloaded once and stored on this device, then loads into memory
          automatically the first time an Auto feature, like auto-categorize, needs it. Delete it
          any time to reclaim the disk space.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <SettingsGroup>
          <SettingAction
            label={
              <>
                {MODEL.label}
                {isDownloaded && diskSize.data != null && (
                  <Badge variant="secondary">{formatBytes(diskSize.data)}</Badge>
                )}
                {stage === 'loading' && (
                  <Badge variant="secondary">
                    <Spinner className="size-3" />
                    Loading into memory
                  </Badge>
                )}
              </>
            }
            description="Runs on your device, so transaction data never leaves it."
          >
            {stage === 'downloading' && (
              <Button
                variant="outline"
                disabled={cancelDownload.isPending}
                onClick={() => cancelDownload.mutate()}
              >
                Cancel
              </Button>
            )}
            {(stage === 'notDownloaded' || stage === 'error') && (
              <Button
                variant="outline"
                disabled={download.isPending}
                onClick={() => download.mutate()}
              >
                {download.isPending
                  ? 'Starting…'
                  : stage === 'error'
                    ? 'Retry download'
                    : 'Download'}
              </Button>
            )}
            {isDownloaded && (
              <Button variant="outline" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            )}
          </SettingAction>
        </SettingsGroup>

        {(stage === 'downloading' || stage === 'verifying') && (
          <div className="space-y-1.5">
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
          </div>
        )}

        {stage === 'error' && status?.error && (
          <p className="text-sm text-destructive">{status.error}</p>
        )}
        {download.isError && (
          <p className="text-sm text-destructive">{ipcErrorMessage(download.error)}</p>
        )}
        {deleteModel.isError && (
          <p className="text-sm text-destructive">{ipcErrorMessage(deleteModel.error)}</p>
        )}
      </CardContent>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${MODEL.label}?`}
        description="This removes the model file from this device. Auto features stop working until you download it again."
        pending={deleteModel.isPending}
        pendingLabel="Deleting…"
        onConfirm={() => deleteModel.mutate()}
      />
    </Card>
  )
}
