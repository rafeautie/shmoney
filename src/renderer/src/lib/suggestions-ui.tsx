import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

// App-wide open/close state for the rule-suggestions dialog. It lives above the
// settings page so a notification fired from any route can open the dialog once
// the settings page mounts, without threading router state into the rules card.
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
