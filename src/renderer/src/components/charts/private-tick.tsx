import type { ReactElement } from 'react'
import { cn } from '@/lib/utils'
import { PrivateText } from '@/components/amount'

const BOX_WIDTH = 160
const BOX_HEIGHT = 16

interface TickProps {
  x: number | string
  y: number | string
  payload: { value: number }
  textAnchor?: string
  verticalAnchor?: string
}

/** Renders value-axis ticks as HTML, so a hidden amount gets the same animated
 * dots and ripple as every other figure; SVG text can't animate per glyph. */
export function privateTick(
  format: (value: number) => string,
  sensitive = true
): (props: TickProps) => ReactElement {
  return function renderTick({ payload, textAnchor, verticalAnchor, ...props }) {
    const x = Number(props.x)
    const y = Number(props.y)
    const left =
      textAnchor === 'end' ? x - BOX_WIDTH : textAnchor === 'middle' ? x - BOX_WIDTH / 2 : x
    const top =
      verticalAnchor === 'start'
        ? y
        : verticalAnchor === 'end'
          ? y - BOX_HEIGHT
          : y - BOX_HEIGHT / 2
    return (
      <foreignObject x={left} y={top} width={BOX_WIDTH} height={BOX_HEIGHT}>
        <div
          className={cn(
            'flex h-full items-center text-muted-foreground',
            textAnchor === 'end' && 'justify-end',
            textAnchor === 'middle' && 'justify-center'
          )}
        >
          <PrivateText
            text={format(payload.value)}
            sensitive={sensitive}
            className="leading-none tabular-nums"
          />
        </div>
      </foreignObject>
    )
  }
}
