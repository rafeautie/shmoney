import { useEffect, useState } from 'react'
import { ImportDialog } from '@/components/accounts/import-dialog'
import { useImportUi } from '@/lib/import-ui'

type OpenedFile = { fileName: string; bytes: Uint8Array }

/**
 * Mounted once at the root. Owns the one import dialog in the app, so a trigger
 * anywhere (ImportButton) opens this one rather than a second copy, and hands it
 * files the OS opened through a file association.
 *
 * Dropping a file is handled only by the dialog's own drop zone.
 */
export function ImportFileHost(): React.JSX.Element {
  const { open, setOpen } = useImportUi()
  const [file, setFile] = useState<OpenedFile | null>(null)

  useEffect(() => window.api.app.onOpenImportFile(setFile), [])

  return (
    <ImportDialog
      open={open || file !== null}
      onOpenChange={(next) => {
        if (next) return
        setOpen(false)
        setFile(null)
      }}
      initialFile={file ?? undefined}
    />
  )
}
