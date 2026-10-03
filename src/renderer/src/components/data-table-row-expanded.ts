import { createContext, use, useLayoutEffect } from 'react'

/** Provided per DataTable row: adds +1/-1 to the row's count of open popovers */
export const RowExpandedContext = createContext<((delta: number) => void) | null>(null)

/** Highlights the enclosing DataTable row while `open` (the cheap stand-in for :has([aria-expanded])) */
export function useRowExpanded(open: boolean): void {
  const report = use(RowExpandedContext)
  useLayoutEffect(() => {
    if (!open || !report) return
    report(1)
    return () => report(-1)
  }, [open, report])
}
