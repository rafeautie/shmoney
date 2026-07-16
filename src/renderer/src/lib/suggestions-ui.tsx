import { createContext, useContext, useMemo, useRef, type ReactNode } from 'react'
import { useState } from 'react'
import type { RuleSuggestionGroup } from '@shared/rule-suggestions'

// App-wide state for the rule-suggestions UI. The dialog and the rule editor
// it launches are mounted globally (RuleSuggestionsHost in the root layout), so
// any trigger on any route can open the dialog — or send a suggestion group
// straight to the editor — in place without navigating.
interface SuggestionsUi {
  open: boolean
  setOpen: (open: boolean) => void
  /** send a suggestion group straight to the rule editor, bypassing the dialog */
  createRule: (group: RuleSuggestionGroup) => void
  /** RuleSuggestionsHost registers the actual editor-opening handler here */
  registerCreateRule: (handler: (group: RuleSuggestionGroup) => void) => void
}

const SuggestionsUiContext = createContext<SuggestionsUi | null>(null)

export function SuggestionsUiProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  // a ref, not state: the handler is registered by the host after mount and
  // calling it shouldn't re-render the provider tree
  const createRuleRef = useRef<(group: RuleSuggestionGroup) => void>(() => {})
  const value = useMemo(
    () => ({
      open,
      setOpen,
      createRule: (group: RuleSuggestionGroup) => createRuleRef.current(group),
      registerCreateRule: (handler: (group: RuleSuggestionGroup) => void) => {
        createRuleRef.current = handler
      }
    }),
    [open]
  )
  return <SuggestionsUiContext.Provider value={value}>{children}</SuggestionsUiContext.Provider>
}

export function useSuggestionsUi(): SuggestionsUi {
  const ctx = useContext(SuggestionsUiContext)
  if (!ctx) throw new Error('useSuggestionsUi must be used within a SuggestionsUiProvider')
  return ctx
}
