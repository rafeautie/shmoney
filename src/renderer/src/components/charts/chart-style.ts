// Chart styling shared by the report widgets and the chat charts, kept out of
// chart.tsx so the component file holds only component exports (which fast
// refresh needs) and so both surfaces color and hide amounts identically.

const PALETTE_SIZE = 10
// emerald and rose read as money in and money out, so they come last: the
// first series of a chart (often spending) never lands on green or red
const PALETTE_ORDER = [1, 2, 5, 6, 7, 8, 3, 4, 9, 10]

/** The one color a single-series chart draws in. */
export const ACCENT_COLOR = 'var(--chart-1)'
/** Uncategorized, "Other" and anything else that is not an entity of its own. */
export const NEUTRAL_COLOR = 'var(--chart-neutral)'

/** Cycles through --chart-1..10; series beyond the palette get the same hues
 * tinted lighter, then darker, so up to 30 series never share a color. */
export function paletteColor(index: number): string {
  const base = `var(--chart-${PALETTE_ORDER[index % PALETTE_SIZE]})`
  const cycle = Math.floor(index / PALETTE_SIZE) % 3
  if (cycle === 0) return base
  return `color-mix(in oklab, ${base}, ${cycle === 1 ? 'white' : 'black'} 30%)`
}

/** A datum may carry its own color under this key (per-point bars, pie slices). */
export const POINT_COLOR = '__color'
