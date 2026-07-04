import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

const STORAGE_KEY = 'shmoney-blur-amounts'

interface PrivacyContextValue {
  blurAmounts: boolean
  setBlurAmounts: (blur: boolean) => void
}

const PrivacyContext = createContext<PrivacyContextValue | null>(null)

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [blurAmounts, setBlurAmountsState] = useState(
    () => localStorage.getItem(STORAGE_KEY) === 'true'
  )

  const setBlurAmounts = useCallback((blur: boolean) => {
    localStorage.setItem(STORAGE_KEY, String(blur))
    setBlurAmountsState(blur)
  }, [])

  const value = useMemo(() => ({ blurAmounts, setBlurAmounts }), [blurAmounts, setBlurAmounts])

  return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>
}

export function usePrivacy() {
  const context = useContext(PrivacyContext)
  if (!context) throw new Error('usePrivacy must be used within a PrivacyProvider')
  return context
}
