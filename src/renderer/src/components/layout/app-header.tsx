import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft01Icon, ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useHistoryNav, useHistoryShortcuts } from '@/lib/history-nav'
import { isMac } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { TitleBarSearch } from './command-palette-host'

const NO_DRAG = '[-webkit-app-region:no-drag]'
const BACK_KEYS = isMac ? '⌘[' : 'Alt+←'
const FORWARD_KEYS = isMac ? '⌘]' : 'Alt+→'

function NavButton({
  label,
  keys,
  icon,
  disabled,
  onClick
}: {
  label: string
  keys: string
  icon: typeof ArrowLeft01Icon
  disabled: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
            className={NO_DRAG}
          />
        }
      >
        <HugeiconsIcon icon={icon} className="size-4" />
      </TooltipTrigger>
      <TooltipContent>
        {label} <span className="text-muted-foreground">{keys}</span>
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * The 40px title bar. Its whole width is the window's drag region, so both ends
 * have to stay clear of whatever the OS draws on top of it, and which end that
 * is differs by platform.
 */
export function AppHeader(): React.JSX.Element {
  const { state } = useSidebar()

  // macOS puts its traffic lights at the window's top-left corner, which is over
  // the sidebar, not this header. Expanded, the 256px sidebar swallows them
  // whole; collapsed it is only 48px, so they run ~20px past it and onto the
  // sidebar trigger. Start the content clear of them in that state.
  const clearTrafficLights = isMac && state === 'collapsed'
  const nav = useHistoryNav()
  useHistoryShortcuts()

  return (
    <header
      className={cn(
        // no rule and no fill of its own: the bar shares the page's background
        // (see the canvas rule in main.css). The 28px controls and the search
        // field share its center line, 10px clear above and below, and the
        // trigger sits 10px from the left to match
        '@container relative flex h-12 shrink-0 items-center gap-2 [-webkit-app-region:drag]'
      )}
      // Windows and Linux draw the caption buttons over the right end of this
      // bar; reserve exactly the strip the Window Controls Overlay reports.
      // Those env vars only resolve where that overlay exists, so on macOS this
      // falls back to the plain 1rem inset.
      //
      // Assumes the buttons are on the right, which holds for Windows and for
      // Chromium's default Linux overlay. A desktop configured to put them on
      // the left would need the inset measured against the sidebar's width
      // instead, since titlebar-area-x is relative to the window, not to this
      // header, and the sidebar already covers the first 48-256px of it.
      //
      // The OS paints those buttons above the page, so no z-index can lift the
      // search over them. Instead --search-room is the lane between the toggle
      // and arrows (6.625rem past the padding) and 12px short of them; the
      // search stays centered while it fits and slides along the lane when one
      // side is crowded. cqw is the bar's content width, so both paddings are
      // added back for its full width.
      style={
        {
          '--bar-pl': clearTrafficLights ? '2rem' : '0.625rem',
          // the web demo's bar claims the same strip through --demo-bar-inset
          '--caption-inset':
            'max(1rem, calc(100vw - env(titlebar-area-width, 100vw) - env(titlebar-area-x, 0px)), var(--demo-bar-inset, 0px))',
          '--search-full': 'calc(100cqw + var(--bar-pl) + var(--caption-inset))',
          '--search-left': 'calc(var(--bar-pl) + 6.625rem)',
          '--search-right': 'calc(var(--caption-inset) + 0.75rem)',
          '--search-room': 'calc(var(--search-full) - var(--search-left) - var(--search-right))',
          paddingInlineStart: 'var(--bar-pl)',
          paddingInlineEnd: 'var(--caption-inset)'
        } as React.CSSProperties
      }
    >
      <SidebarTrigger size="icon" className={NO_DRAG} />
      <div className="flex items-center gap-0.5">
        <NavButton
          label="Back"
          keys={BACK_KEYS}
          icon={ArrowLeft01Icon}
          disabled={!nav.canGoBack}
          onClick={nav.back}
        />
        <NavButton
          label="Forward"
          keys={FORWARD_KEYS}
          icon={ArrowRight01Icon}
          disabled={!nav.canGoForward}
          onClick={nav.forward}
        />
      </div>
      {/* the command palette lives here: type to search, results drop down below */}
      <TitleBarSearch
        className={cn(
          // centered in the bar (10px above and below) and pinned by its top, so
          // opening grows it downward
          'absolute top-2.5 left-1/2 z-30 -translate-x-1/2',
          NO_DRAG
        )}
      />
    </header>
  )
}
