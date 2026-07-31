import { NotificationCenter } from '@/components/layout/notification-center'
import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import { isMac } from '@/lib/platform'
import { cn } from '@/lib/utils'

/**
 * The 48px title bar. Its whole width is the window's drag region, so both ends
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

  return (
    <header
      className={cn(
        'relative flex h-12 shrink-0 items-center gap-2 border-b bg-background pl-4 [-webkit-app-region:drag]',
        clearTrafficLights && 'pl-9'
      )}
      // Windows and Linux draw the caption buttons over the right end of this
      // bar; reserve exactly the strip the Window Controls Overlay reports.
      // Those env vars only resolve where that overlay exists, so on macOS this
      // falls back to the plain pl-4 inset.
      //
      // Assumes the buttons are on the right, which holds for Windows and for
      // Chromium's default Linux overlay. A desktop configured to put them on
      // the left would need the inset measured against the sidebar's width
      // instead, since titlebar-area-x is relative to the window, not to this
      // header, and the sidebar already covers the first 48-256px of it.
      style={{
        paddingInlineEnd:
          'max(1rem, calc(100vw - env(titlebar-area-width, 100vw) - env(titlebar-area-x, 0px)))'
      }}
    >
      <SidebarTrigger size="icon" className="-ml-1 [-webkit-app-region:no-drag]" />
      <div className="flex [-webkit-app-region:no-drag]">
        <NotificationCenter />
      </div>
    </header>
  )
}
