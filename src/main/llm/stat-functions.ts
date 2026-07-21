// Custom SQLite aggregate functions the chat query tool exposes on top of
// SQLite's built-ins. SQLite ships SUM/AVG/MIN/MAX/COUNT but not the
// distribution stats a "what's typical / how much does it vary / is this month
// unusual" question needs, and a small model cannot compute median, a
// percentile or a standard deviation by hand. Adding them as SQL aggregates
// keeps everything in the ONE query vocabulary the model already writes: they
// group and filter like any aggregate, and a query using them returns rows the
// chart tool can draw, so no separate "stats" tool with its query-then-hand-off
// dance is needed.
//
// Pure module, like sql-tool.ts and the other tool helpers: it holds only the
// accumulator definitions and a registrar, no Electron-bound import, so vitest
// loads it and the real connection (better-sqlite3 in the worker) and the test
// connection (node:sqlite) register identical functions from one source.

/**
 * The shape both SQLite bindings accept for a custom aggregate: a fresh
 * accumulator, a step called per row that returns the next accumulator (both
 * bindings support returning it, and node:sqlite requires it), and a result
 * that reads the final accumulator. Every measure returns null on no data, so a
 * group that matched nothing reads as "no data" rather than a misleading 0.
 */
export interface StatAggregate {
  start: () => unknown
  step: (accumulator: unknown, ...args: unknown[]) => unknown
  result: (accumulator: unknown) => number | null
}

/** a SQLite value coerced to a usable number, or null for anything non-numeric */
function numeric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') return Number(value)
  return null
}

/** MEDIAN(x): the middle value, resisting the outliers that pull AVG around */
const median: StatAggregate = {
  start: () => [],
  step: (accumulator, value) => {
    const values = accumulator as number[]
    const n = numeric(value)
    if (n !== null) values.push(n)
    return values
  },
  result: (accumulator) => {
    const values = accumulator as number[]
    if (values.length === 0) return null
    values.sort((a, b) => a - b)
    const mid = values.length >> 1
    return values.length % 2 === 1 ? values[mid] : (values[mid - 1] + values[mid]) / 2
  }
}

interface PercentileAcc {
  values: number[]
  percentile: number | null
}

/** PERCENTILE(x, p): the linearly-interpolated p-th percentile, p in 0..100 */
const percentile: StatAggregate = {
  start: () => ({ values: [], percentile: null }),
  step: (accumulator, value, p) => {
    const acc = accumulator as PercentileAcc
    const n = numeric(value)
    if (n !== null) acc.values.push(n)
    // p is a constant across the group's rows; the last non-null wins
    const requested = numeric(p)
    if (requested !== null) acc.percentile = requested
    return acc
  },
  result: (accumulator) => {
    const acc = accumulator as PercentileAcc
    if (acc.values.length === 0 || acc.percentile === null) return null
    acc.values.sort((a, b) => a - b)
    const clamped = Math.min(100, Math.max(0, acc.percentile))
    const pos = (clamped / 100) * (acc.values.length - 1)
    const lo = Math.floor(pos)
    const hi = Math.ceil(pos)
    return lo === hi
      ? acc.values[lo]
      : acc.values[lo] + (acc.values[hi] - acc.values[lo]) * (pos - lo)
  }
}

interface StddevAcc {
  count: number
  mean: number
  m2: number
}

/** STDDEV(x): sample standard deviation via Welford; null under two values */
const stddev: StatAggregate = {
  start: () => ({ count: 0, mean: 0, m2: 0 }),
  step: (accumulator, value) => {
    const acc = accumulator as StddevAcc
    const n = numeric(value)
    if (n !== null) {
      acc.count += 1
      const delta = n - acc.mean
      acc.mean += delta / acc.count
      acc.m2 += delta * (n - acc.mean)
    }
    return acc
  },
  result: (accumulator) => {
    const acc = accumulator as StddevAcc
    return acc.count < 2 ? null : Math.sqrt(acc.m2 / (acc.count - 1))
  }
}

export const STAT_AGGREGATES: Record<string, StatAggregate> = { median, percentile, stddev }

/**
 * Register every stat aggregate on a SQLite connection. Takes a `register`
 * callback rather than the connection itself because the two bindings we use
 * (better-sqlite3 in the worker, node:sqlite in tests) type their `aggregate`
 * options differently, and @types/better-sqlite3 in particular types only a
 * single-argument step, so it cannot express PERCENTILE's two args even though
 * the runtime infers arity from step.length and supports them. The tiny cast to
 * each binding's option type therefore lives at the two call sites, not here.
 */
export function registerStatFunctions(register: (name: string, def: StatAggregate) => void): void {
  for (const [name, def] of Object.entries(STAT_AGGREGATES)) register(name, def)
}
