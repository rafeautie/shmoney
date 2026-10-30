import { useState } from 'react'

export const DIM_OPACITY = 0.25

/** Goes on the ChartContainer so marks fade as they dim. The hover dot would
 * otherwise sit over the series under the pointer and swallow its hover. */
export const HOVER_FADE =
  'motion-safe:[&_.recharts-surface_path]:transition-[fill-opacity,stroke-opacity] motion-safe:[&_.recharts-surface_path]:duration-150 [&_.recharts-active-dot]:pointer-events-none'

/** Hovering a series, slice or bar (in the plot or the legend) dims the rest.
 * Keys are whatever the chart identifies marks by: a series key, a slice label,
 * a row index. */
export function useHoverDim() {
  const [active, setActive] = useState<string | null>(null)
  return {
    active,
    setActive,
    clear: () => setActive(null),
    /** opacity multiplier for the mark with this key */
    shown: (key: string) => (active === null || active === key ? 1 : DIM_OPACITY),
    hover: (key: string) => ({
      onMouseEnter: () => setActive(key),
      onMouseLeave: () => setActive(null)
    })
  }
}
