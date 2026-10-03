// Chart styling shared by the report widgets and the chat charts, kept out of
// chart.tsx so the component file holds only component exports (which fast
// refresh needs) and so both surfaces color and hide amounts identically.

const PALETTE_SIZE = 10

/** Cycles through --chart-1..10; series beyond the palette get the same hues
 * tinted lighter, then darker, so up to 30 series never share a color. */
export function paletteColor(index: number): string {
  const base = `var(--chart-${(index % PALETTE_SIZE) + 1})`
  const cycle = Math.floor(index / PALETTE_SIZE) % 3
  if (cycle === 0) return base
  return `color-mix(in oklab, ${base}, ${cycle === 1 ? 'white' : 'black'} 30%)`
}
