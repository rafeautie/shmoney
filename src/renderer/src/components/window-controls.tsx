import { useEffect, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon, Copy01Icon, MinusSignIcon, SquareIcon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'

export function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    window.api.window.isMaximized().then(setIsMaximized)
    return window.api.window.onMaximizedChange(setIsMaximized)
  }, [])

  return (
    <div className="flex items-center gap-1 [-webkit-app-region:no-drag]">
      <Button variant="ghost" size="icon" onClick={() => window.api.window.minimize()}>
        <HugeiconsIcon icon={MinusSignIcon} strokeWidth={2} />
        <span className="sr-only">Minimize</span>
      </Button>
      <Button variant="ghost" size="icon" onClick={() => window.api.window.maximizeToggle()}>
        <HugeiconsIcon icon={isMaximized ? Copy01Icon : SquareIcon} strokeWidth={2} />
        <span className="sr-only">{isMaximized ? 'Restore' : 'Maximize'}</span>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="hover:bg-destructive/15 hover:text-destructive dark:hover:bg-destructive/25"
        onClick={() => window.api.window.close()}
      >
        <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
        <span className="sr-only">Close</span>
      </Button>
    </div>
  )
}
