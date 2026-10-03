// SQLite's lower() and LIKE fold ASCII letters only (no ICU), so matching in
// JS has to fold the same way to agree with a compiled `contains` rule
function asciiLower(text: string): string {
  return text.replace(/[A-Z]+/g, (run) => run.toLowerCase())
}

/**
 * Counts, for any phrase, how many rows a `contains` rule on that phrase would
 * match, given the candidate rows grouped by exact description. Same semantics
 * as compileConditions' `lower(description) like lower('%phrase%')`, so one
 * grouped scan can answer any number of phrases.
 */
export function createPhraseCounter(
  rows: { description: string; n: number }[]
): (phrase: string) => number {
  const folded = rows.map((r) => ({ text: asciiLower(r.description), n: r.n }))
  const cache = new Map<string, number>()
  return (phrase) => {
    const needle = asciiLower(phrase)
    let count = cache.get(needle)
    if (count === undefined) {
      count = 0
      for (const row of folded) if (row.text.includes(needle)) count += row.n
      cache.set(needle, count)
    }
    return count
  }
}
