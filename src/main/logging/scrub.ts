import os from 'node:os'

// Enough for a full stack trace; external systems (SQLite, SimpleFIN, llama.cpp)
// aren't trusted to keep their messages small.
const MAX_ERROR_CHARS = 2000

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Replace every occurrence of the user's home directory with `~` so log lines
 * and stack traces never carry the OS username. Matches both slash styles
 * (Windows stacks mix `\` and `/` once bundlers are involved) and ignores
 * case, since Windows paths are case-insensitive.
 */
export function scrubText(text: string, home: string = os.homedir()): string {
  const segments = home.split(/[\\/]+/).filter(Boolean)
  // a degenerate home ('/' or '') would turn the scrub into noise
  if (segments.length < 2) return text
  // POSIX homes are rooted at a separator; that slash is part of the match
  const root = /^[\\/]/.test(home) ? '[\\\\/]' : ''
  const pattern = root + segments.map(escapeRegExp).join('[\\\\/]+')
  return text.replace(new RegExp(pattern, 'gi'), '~')
}

/**
 * One scrubbed, length-capped string for a caught value. Prefers the stack
 * (its first line already carries `Name: message`) and prefixes Node/SQLite
 * error codes, which don't appear in stacks.
 */
export function serializeError(err: unknown, home?: string): string {
  let text: string
  if (err instanceof Error) {
    text = err.stack ?? `${err.name}: ${err.message}`
    const code = (err as NodeJS.ErrnoException).code
    if (code) text = `[${code}] ${text}`
  } else if (typeof err === 'string') {
    text = err
  } else {
    try {
      text = JSON.stringify(err) ?? String(err)
    } catch {
      text = String(err)
    }
  }
  if (text.length > MAX_ERROR_CHARS) text = `${text.slice(0, MAX_ERROR_CHARS)}…`
  return scrubText(text, home)
}
