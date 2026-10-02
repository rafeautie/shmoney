import { lazy, Suspense, useEffect, useState } from 'react'
import { useImportUi } from '@/lib/import-ui'

// fetched the first time an import starts, not with the app shell
const ImportDialog = lazy(() =>
  import('@/components/accounts/import-dialog').then((m) => ({ default: m.ImportDialog }))
)

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
  // once loaded, stay mounted so the close animation plays
  if (isOpen && !started) setStarted(true)
  if (!started) return null

  return (
    <Suspense fallback={null}>
      <ImportDialog
        open={isOpen}
        onOpenChange={(next) => {
          if (next) return
          setOpen(false)
          setFile(null)
        }}
        initialFile={file ?? undefined}
      />
    </Suspense>
  )
}
