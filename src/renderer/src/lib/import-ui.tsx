import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

// App-wide open state for the import dialog. The dialog is mounted once in the
// root layout (ImportFileHost), so a button on a page and a file dropped on the
// window open the same one instead of stacking two.
interface ImportUi {
  open: boolean
  setOpen: (open: boolean) => void
}

const ImportUiContext = createContext<ImportUi | null>(null)

export function ImportUiProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const value = useMemo(() => ({ open, setOpen }), [open])
  return <ImportUiContext.Provider value={value}>{children}</ImportUiContext.Provider>
}

export function useImportUi(): ImportUi {
  const ctx = useContext(ImportUiContext)
  if (!ctx) throw new Error('useImportUi must be used within an ImportUiProvider')
  return ctx
}
