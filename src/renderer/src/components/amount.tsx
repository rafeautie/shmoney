import { useLayoutEffect, useRef, type CSSProperties, type Ref, type RefObject } from 'react'
import { cn, formatAmount, formatShares } from '@/lib/utils'
import { usePrivacy } from '@/lib/settings'
import { usePrivacySettling } from '@/lib/privacy-transition'
import { toGlyphs } from '@/lib/mask-glyphs'

function MaskedGlyphs({ text }: { text: string }) {
  return toGlyphs(text).map((glyph, i) => {
    if (glyph.kind === 'fixed')
      return glyph.gap ? (
        <span key={`gap${i}`} className={`private-gap-${glyph.gap}`}>
          {glyph.char}
        </span>
      ) : (
        glyph.char
      )
    const style = { '--i': glyph.index } as CSSProperties
    if (glyph.kind === 'digit')
      return (
        <span key={`slot${i}`} className="private-slot" style={style}>
          <span className="private-glyph">{glyph.char}</span>
          <span className="private-dot" />
        </span>
      )
    if (glyph.kind === 'drop')
      return (
        <span key={`drop${i}`} className="private-drop" style={style}>
          <span>
            <span className="private-glyph">{glyph.char}</span>
          </span>
        </span>
      )
    return (
      <span key={`pad${i}`} className="private-pad" style={style}>
        <span>
          <span className="private-slot">
            <span className="invisible">0</span>
            <span className="private-dot" />
          </span>
        </span>
      </span>
    )
  })
}

interface PrivateTextProps {
  text: string
  className?: string
  /** False renders plain text that ignores the privacy toggle */
  sensitive?: boolean
  ref?: Ref<HTMLSpanElement>
}

/**
 * A figure the privacy toggle hides: its digits slide out and four dots slide
 * in, rippling from the sidebar toggle (see privacy-transition). Plain text
 * whenever it is shown and settled, so long tables stay light.
 */
export function PrivateText({ text, className, sensitive = true, ref }: PrivateTextProps) {
  const { blurAmounts } = usePrivacy()
  const settling = usePrivacySettling()
  const hidden = sensitive && blurAmounts
  const masked = sensitive && (blurAmounts || settling)

  return (
    <span
      ref={ref}
      data-private={sensitive ? '' : undefined}
      className={cn(
        // figures are the user's data wherever they appear (cards, headers,
        // tooltips), so they select; a hidden one is dots, not readable
        hidden ? 'select-none' : 'select-text',
        className,
        masked && 'private',
        hidden && 'private-hidden',
        settling && 'private-enter'
      )}
    >
      {masked ? <MaskedGlyphs text={text} /> : text}
    </span>
  )
}

interface AmountProps {
  /** Integer milliunits (value * 1000) */
  value: number
  currency: string
  /** Set false to skip the green/red sign coloring */
  colored?: boolean
  /** Count from the old value to the new one when it changes in place */
  tween?: boolean
  className?: string
}

const TWEEN_MS = 400
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

/**
 * Counts a shown figure to its new value by rewriting the text node React
 * rendered, so a tween costs no renders. React has already written the final
 * text; the layout effect rewinds it before paint and each frame steps it on.
 */
function useCountUp(
  ref: RefObject<HTMLSpanElement | null>,
  value: number,
  currency: string,
  enabled: boolean
): void {
  const shown = useRef(value)
  useLayoutEffect(() => {
    const from = shown.current
    const node = ref.current?.firstChild
    if (!enabled || from === value || !(node instanceof Text) || reducedMotion.matches) {
      shown.current = value
      return
    }
    const start = performance.now()
    let frame = 0
    const step = (now: number): void => {
      // a frame can be stamped a little before the effect ran
      const t = Math.min(1, Math.max(0, (now - start) / TWEEN_MS))
      const eased = t < 0.5 ? 4 * t ** 3 : 1 - (2 - 2 * t) ** 3 / 2
      shown.current = t === 1 ? value : Math.round((from + (value - from) * eased) / 10) * 10
      node.nodeValue = formatAmount(shown.current, currency)
      if (t < 1) frame = requestAnimationFrame(step)
    }
    step(start)
    // no text restore here: React has already written the next value's text
    return () => cancelAnimationFrame(frame)
  }, [ref, value, currency, enabled])
}

export function Amount({ value, currency, colored = true, tween = false, className }: AmountProps) {
  const { blurAmounts } = usePrivacy()
  const settling = usePrivacySettling()
  const ref = useRef<HTMLSpanElement>(null)
  // a masked figure runs its own dot animation; it just lands on the new value
  useCountUp(ref, value, currency, tween && !blurAmounts && !settling)

  return (
    <PrivateText
      ref={ref}
      text={formatAmount(value, currency)}
      className={cn(
        'tabular-nums duration-0',
        colored && value > 0 && 'text-positive',
        colored && value < 0 && 'text-negative',
        className
      )}
    />
  )
}

interface SharesProps {
  /** Exact decimal string (or number) of shares/units held */
  value: string | number
  className?: string
}

/** A share/unit count; hidden by the same privacy toggle as {@link Amount}. */
export function Shares({ value, className }: SharesProps) {
  return <PrivateText text={formatShares(value)} className={cn('tabular-nums', className)} />
}
