import { useEffect, useState } from 'react'
import { useImportUi } from '@/lib/import-ui'
import { useIdleModule } from '@/lib/use-idle-module'

// kept out of the app shell, loaded once the app is idle
const loadImportDialog = () => import('@/components/accounts/import-dialog')

type OpenedFile = { fileName: string; bytes: Uint8Array }

/**
 * Mounted once at the root. Owns the one import dialog in the app, so a trigger
 * anywhere (ImportButton) opens this one rather than a second copy, and hands it
 * files the OS opened through a file association.
 *
 * Dropping a file is handled only by the dialog's own drop zone.
 */
export function ImportFileHost(): React.JSX.Element | null {
  const { open, setOpen } = useImportUi()
  const [file, setFile] = useState<OpenedFile | null>(null)
  const [started, setStarted] = useState(false)

  useEffect(() => window.api.app.onOpenImportFile(setFile), [])

  const isOpen = open || file !== null
  const mod = useIdleModule(loadImportDialog, isOpen)
  // once opened, stay mounted so the close animation plays
  if (isOpen && !started) setStarted(true)
  if (!started || !mod) return null

  return (
    <mod.ImportDialog
      open={isOpen}
      onOpenChange={(next) => {
        if (next) return
        setOpen(false)
        setFile(null)
      }}
      initialFile={file ?? undefined}
    />
  )
}
