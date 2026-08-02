import { useEffect, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { FileImportIcon } from '@hugeicons/core-free-icons'
import { ImportDialog } from '@/components/accounts/import-dialog'
import { useImportUi } from '@/lib/import-ui'

type DroppedFile = { fileName: string; bytes: Uint8Array }

const STATEMENT_EXTENSIONS = /\.(csv|tsv|ofx|qfx|qif)$/i

/**
 * Mounted once at the root. Makes the whole window a drop target for statement
 * files and receives files the OS opened through a file association, then hands
 * either to the import dialog. Owns the one import dialog in the app, so a
 * trigger anywhere (ImportButton) opens this one rather than a second copy.
 *
 * Without this the only drop target is the import dialog's own empty state, so
 * a file dropped anywhere else lands in a dead zone that shows a copy cursor
 * and does nothing.
 */
export function ImportFileHost(): React.JSX.Element {
  const { open, setOpen } = useImportUi()
  const [file, setFile] = useState<DroppedFile | null>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => window.api.app.onOpenImportFile(setFile), [])

  useEffect(() => {
    // dragenter/dragleave fire for every element crossed, so count depth rather
    // than toggling a boolean, or the overlay flickers across child boundaries
    let depth = 0

    const isFileDrag = (event: DragEvent): boolean =>
      event.dataTransfer?.types.includes('Files') ?? false

    const onDragEnter = (event: DragEvent): void => {
      if (!isFileDrag(event)) return
      depth++
      setDragging(true)
    }
    const onDragOver = (event: DragEvent): void => {
      // without this the browser handles the drop itself, which in Electron
      // means trying to navigate the window to the file
      if (isFileDrag(event)) event.preventDefault()
    }
    const onDragLeave = (event: DragEvent): void => {
      if (!isFileDrag(event)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const onDrop = (event: DragEvent): void => {
      if (!isFileDrag(event)) return
      event.preventDefault()
      depth = 0
      setDragging(false)
      const dropped = event.dataTransfer?.files[0]
      // anything else is not something the importer can read; ignoring it
      // leaves the file where it was rather than opening a dialog that errors
      if (!dropped || !STATEMENT_EXTENSIONS.test(dropped.name)) return
      void dropped
        .arrayBuffer()
        .then((buffer) => setFile({ fileName: dropped.name, bytes: new Uint8Array(buffer) }))
    }

    document.addEventListener('dragenter', onDragEnter)
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('dragleave', onDragLeave)
    document.addEventListener('drop', onDrop)
    return () => {
      document.removeEventListener('dragenter', onDragEnter)
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('dragleave', onDragLeave)
      document.removeEventListener('drop', onDrop)
    }
  }, [])

  return (
    <>
      {dragging && (
        // starts below the title bar: the OS draws its caption buttons over that
        // strip, so an overlay running under them comes out with holes punched
        // in it
        <div className="pointer-events-none fixed top-14 right-2 bottom-2 left-2 z-50 flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-primary bg-background/80 backdrop-blur-xs">
          <HugeiconsIcon icon={FileImportIcon} size={32} className="text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Drop a statement file to import</p>
        </div>
      )}
      <ImportDialog
        open={open || file !== null}
        onOpenChange={(next) => {
          if (next) return
          setOpen(false)
          setFile(null)
        }}
        initialFile={file ?? undefined}
      />
    </>
  )
}
