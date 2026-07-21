import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon, Cancel01Icon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'

export interface ChatWarningAction {
  label: string
  onClick: () => void
  disabled?: boolean
}

/** One entry the warning system can surface; keyed so a dismissal sticks to it. */
export interface ChatWarningItem {
  /** stable id — identifies the warning across renders and remembers its dismissal */
  key: string
  message: React.ReactNode
  /** optional second line — e.g. why acting on the warning helps */
  subtitle?: React.ReactNode
  action?: ChatWarningAction
}

/**
 * A dismissable amber notice for the chat composer. It insets slightly from the
 * input and rounds only its top corners, so it reads as a tab pinned to the pill
 * below it. Purely presentational: pass a message, an optional action button, and
 * a dismiss handler. Dismissing slides it down and collapses its row height, so the
 * composer and the empty state above it slide up smoothly; the parent removes it
 * once that collapse finishes.
 */
export function ChatWarning({
  children,
  subtitle,
  action,
  onDismiss
}: {
  children: React.ReactNode
  subtitle?: React.ReactNode
  action?: ChatWarningAction
  onDismiss: () => void
}) {
  const [leaving, setLeaving] = useState(false)
  return (
    // the outer grid animates its row from 1fr to 0fr on the way out, so the
    // height change is real layout and everything above reflows smoothly. min-h-0
    // (rather than overflow-hidden) is what lets the row collapse to zero while
    // leaving overflow visible, so the banner can slide down past the seam and
    // tuck behind the composer, which sits above it in the stacking order
    <div
      onTransitionEnd={(e) => {
        if (leaving && e.propertyName === 'grid-template-rows') onDismiss()
      }}
      className={cn(
        'grid transition-[grid-template-rows] duration-200 ease-out',
        leaving ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'
      )}
    >
      <div className="min-h-0">
        <div
          className={cn(
            'mx-2 flex items-center gap-2.5 rounded-t-2xl border border-b-0 border-amber-500/30 bg-amber-500/10 py-2 pr-2 pl-3.5 transition duration-200 ease-out',
            leaving && 'translate-y-2 opacity-0'
          )}
        >
          <HugeiconsIcon
            icon={Alert02Icon}
            size={16}
            className="shrink-0 text-amber-600 dark:text-amber-400"
          />
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="text-[0.8125rem] text-foreground">{children}</p>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          {action && (
            <button
              type="button"
              onClick={action.onClick}
              disabled={action.disabled}
              className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-500/15 focus-visible:ring-2 focus-visible:ring-amber-500/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 dark:text-amber-400"
            >
              {action.label}
            </button>
          )}
          <button
            type="button"
            onClick={() => setLeaving(true)}
            aria-label="Dismiss"
            className="shrink-0 rounded-md p-1 text-amber-700/70 transition-colors hover:bg-amber-500/15 hover:text-amber-700 focus-visible:ring-2 focus-visible:ring-amber-500/40 focus-visible:outline-none dark:text-amber-400/70 dark:hover:text-amber-400"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  )
}
