import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { bugReportUrl } from '@/lib/github'

/**
 * Transparency is the point of this dialog: the preview below is the exact
 * text `Copy diagnostics` puts on the clipboard, nothing is copied or sent
 * without an explicit click, and declining to copy costs nothing.
 */
export function ReportBugDialog() {
  const [open, setOpen] = useState(false)
  const diagnostics = useQuery({
    queryKey: ['diagnostics'],
    queryFn: () => window.api.diagnostics.get(),
    enabled: open,
    // refetch on every open so the preview reflects the log as it is right now
    staleTime: 0,
    gcTime: 0
  })

  // window.open on an https URL routes through setWindowOpenHandler to the OS
  // browser (see main/index.ts)
  function openGitHub(): void {
    window.open(bugReportUrl())
    setOpen(false)
  }

  async function copyAndOpenGitHub(): Promise<void> {
    if (diagnostics.data === undefined) return
    await window.api.diagnostics.copy(diagnostics.data)
    toast('Diagnostics copied to your clipboard', {
      description: 'Paste them into the Diagnostics field of the GitHub issue.'
    })
    openGitHub()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>Report bug</DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Report a bug</DialogTitle>
          <DialogDescription>
            shmoney can copy the diagnostics below to your clipboard so you can paste them into the
            GitHub issue. This is exactly what would be copied; no account, transaction, or balance
            data, and nothing is sent anywhere by shmoney itself.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="rounded-lg border bg-muted/30" viewPortClassName="max-h-[40vh]">
          <pre className="p-3 text-xs whitespace-pre-wrap break-all">
            {diagnostics.data ?? 'Collecting diagnostics…'}
          </pre>
        </ScrollArea>
        <DialogFooter>
          <Button
            variant="link"
            className="px-0 sm:mr-auto"
            onClick={() => void window.api.diagnostics.openLogsFolder()}
          >
            Open logs folder
          </Button>
          <Button variant="outline" onClick={openGitHub}>
            Open GitHub without copying
          </Button>
          <Button
            disabled={diagnostics.data === undefined}
            onClick={() => void copyAndOpenGitHub()}
          >
            Copy diagnostics &amp; open GitHub
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
