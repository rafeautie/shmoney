import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { bugReportUrl } from '@/lib/github'
import { SettingsSubpage } from './settings-controls'

/**
 * About › Report a bug. Transparency is the point: the preview below is the
 * exact text `Copy diagnostics` puts on the clipboard, nothing is copied or
 * sent without an explicit click, and declining to copy costs nothing.
 */
export function ReportBugPage({ onBack }: { onBack: () => void }) {
  const diagnostics = useQuery({
    queryKey: ['diagnostics'],
    queryFn: () => window.api.diagnostics.get(),
    // refetch on every visit so the preview reflects the log as it is right now
    staleTime: 0,
    gcTime: 0
  })

  // window.open on an https URL routes through setWindowOpenHandler to the OS
  // browser (see main/index.ts)
  function openGitHub(): void {
    window.open(bugReportUrl())
    onBack()
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
    <SettingsSubpage
      parent="About"
      title="Report a bug"
      description="shmoney can copy the diagnostics below to your clipboard so you can paste them into the GitHub issue. This is exactly what would be copied; no account, transaction, or balance data, and nothing is sent anywhere by shmoney itself."
      onBack={onBack}
    >
      <ScrollArea className="rounded-lg border bg-muted/30" viewPortClassName="max-h-[45vh]">
        <pre className="p-3 text-xs whitespace-pre-wrap break-all">
          {diagnostics.data ?? 'Collecting diagnostics…'}
        </pre>
      </ScrollArea>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="link"
          className="mr-auto px-0"
          onClick={() => void window.api.diagnostics.openLogsFolder()}
        >
          Open logs folder
        </Button>
        <Button variant="outline" onClick={openGitHub}>
          Open GitHub without copying
        </Button>
        <Button disabled={diagnostics.data === undefined} onClick={() => void copyAndOpenGitHub()}>
          Copy diagnostics and open GitHub
        </Button>
      </div>
    </SettingsSubpage>
  )
}
