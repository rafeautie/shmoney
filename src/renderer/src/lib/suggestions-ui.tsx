import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

// App-wide open/close state for the rule-suggestions dialog. The dialog itself
// is mounted globally (RuleSuggestionsHost in the root layout), so any trigger
// on any route can open it in place without navigating.
interface SuggestionsUi {
  open: boolean
  setOpen: (open: boolean) => void
}

const SuggestionsUiContext = createContext<SuggestionsUi | null>(null)

export function SuggestionsUiProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const value = useMemo(() => ({ open, setOpen }), [open])
  return <SuggestionsUiContext.Provider value={value}>{children}</SuggestionsUiContext.Provider>
}

export function useSuggestionsUi(): SuggestionsUi {
  const ctx = useContext(SuggestionsUiContext)
  if (!ctx) throw new Error('useSuggestionsUi must be used within a SuggestionsUiProvider')
  return ctx
}
