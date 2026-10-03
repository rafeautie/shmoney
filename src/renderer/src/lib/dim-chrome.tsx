import { useEffect } from 'react'

// counted so a dialog opened over another keeps the buttons dimmed until both close
let open = 0

/**
 * A modal backdrop that also dims the native caption buttons, which sit above
 * the page where it cannot reach. Keyed to the dialog's open state rather than
 * the backdrop's mount, so both fades start on the same frame.
 */
export function ChromeDimmingBackdrop({
  open: active,
  fadeMs,
  ...props
}: React.ComponentProps<'div'> & { open: boolean; fadeMs: number }): React.JSX.Element {
  useEffect(() => {
    if (!active) return
    if (open++ === 0) window.api.app.dimChrome(true, fadeMs)
    return () => {
      if (--open === 0) window.api.app.dimChrome(false, fadeMs)
    }
  }, [active, fadeMs])
  return <div {...props} />
}
