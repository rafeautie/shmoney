export interface NiceScale {
  domain: [number, number]
  ticks: number[]
}

const STEPS = [1, 2, 2.5, 5, 10]

/**
 * Axis ticks on round steps (1, 2, 2.5 or 5 times a power of ten) spanning
 * [min, max] and zero. Recharts' own nice steps land on values like 350 and
 * 1,050, which compact formatting then rounds into labels that disagree with
 * the gridlines. `integer` keeps counts from getting fractional ticks.
 */
export function niceScale(min: number, max: number, integer = false, target = 4): NiceScale {
  let lo = Math.min(0, min)
  let hi = Math.max(0, max)
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { domain: [0, 1], ticks: [0, 1] }
  if (hi === lo) hi = lo + 1
  const raw = (hi - lo) / target
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  let step = magnitude * (STEPS.find((f) => f * magnitude >= raw) ?? 10)
  if (integer) step = Math.max(1, Math.round(step))
  lo = Math.floor(lo / step) * step
  hi = Math.ceil(hi / step) * step
  const ticks: number[] = []
  // integer steps keep this exact; the rounding guards against float drift
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(Math.round(t / step) * step)
  return { domain: [lo, hi], ticks }
}
