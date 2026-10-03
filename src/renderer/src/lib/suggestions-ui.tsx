import { createContext, useContext, useMemo, useRef, type ReactNode } from 'react'
import type { RuleSuggestionGroup } from '@shared/rule-suggestions'

// App-wide handle for turning a rule suggestion into a rule. The editor it
// launches is mounted globally (RuleSuggestionsHost in the root layout), so a
// trigger on any route (the Activity page) can send a suggestion group straight
// to the editor in place without navigating.
interface SuggestionsUi {
  /** send a suggestion group straight to the rule editor */
  createRule: (group: RuleSuggestionGroup) => void
  /** RuleSuggestionsHost registers the actual editor-opening handler here */
  registerCreateRule: (handler: (group: RuleSuggestionGroup) => void) => void
}

const SuggestionsUiContext = createContext<SuggestionsUi | null>(null)

export function SuggestionsUiProvider({ children }: { children: ReactNode }): React.JSX.Element {
  // a ref, not state: the handler is registered by the host after mount and
  // calling it shouldn't re-render the provider tree
  const createRuleRef = useRef<(group: RuleSuggestionGroup) => void>(() => {})
  const value = useMemo(
    () => ({
      createRule: (group: RuleSuggestionGroup) => createRuleRef.current(group),
      registerCreateRule: (handler: (group: RuleSuggestionGroup) => void) => {
        createRuleRef.current = handler
      }
    }),
    []
  )
  return <SuggestionsUiContext.Provider value={value}>{children}</SuggestionsUiContext.Provider>
}

export function useSuggestionsUi(): SuggestionsUi {
  const ctx = useContext(SuggestionsUiContext)
  if (!ctx) throw new Error('useSuggestionsUi must be used within a SuggestionsUiProvider')
  return ctx
}
