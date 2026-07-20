// Chart styling shared by the report widgets and the chat charts, kept out of
// chart.tsx so the component file holds only component exports (which fast
// refresh needs) and so both surfaces color and blur identically.

const PALETTE_SIZE = 10

/** Cycles through --chart-1..10; series beyond the palette get the same hues
 * tinted lighter, then darker, so up to 30 series never share a color. */
export function paletteColor(index: number): string {
  const base = `var(--chart-${(index % PALETTE_SIZE) + 1})`
  const cycle = Math.floor(index / PALETTE_SIZE) % 3
  if (cycle === 0) return base
  return `color-mix(in oklab, ${base}, ${cycle === 1 ? 'white' : 'black'} 30%)`
}

// Recharts renders y-axis tick text outside the g that YAxis's className lands
// on, so the privacy blur has to target the labels from the chart container.
export const BLUR_Y_TICK_LABELS =
  '[&_.recharts-yAxis-tick-labels]:blur-sm [&_.recharts-yAxis-tick-labels]:select-none [&_.recharts-yAxis-tick-labels]:bg-foreground/20'
