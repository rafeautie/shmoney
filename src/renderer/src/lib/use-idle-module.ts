import { useEffect, useState } from 'react'

/**
 * Loads a code-split module once the app is idle, or right away when `needed`.
 * Used instead of React.lazy for on-demand dialogs: a lazy component suspends on
 * its first render even when its chunk is already loaded, and React throttles
 * the reveal by up to ~300ms, which made first opens feel delayed.
 */
export function useIdleModule<T>(load: () => Promise<T>, needed: boolean): T | null {
  const [mod, setMod] = useState<T | null>(null)
  useEffect(() => {
    if (mod) return
    let live = true
    const start = () => void load().then((m) => live && setMod(m))
    if (needed) {
      start()
      return () => {
        live = false
      }
    }
    const id = requestIdleCallback(start)
    return () => {
      live = false
      cancelIdleCallback(id)
    }
  }, [load, needed, mod])
  return mod
}
