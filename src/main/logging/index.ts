import { join } from 'node:path'
import { app } from 'electron'
import log from 'electron-log/main'
import { scrubText, serializeError } from './scrub'

/**
 * The only shapes a log line may carry: structured, known-safe primitives.
 * Never transaction descriptions, payees, amounts, account names, or tokens;
 * log ids and counts instead.
 */
export type LogMeta = Record<string, string | number | boolean | null | undefined>

export interface Logger {
  debug(event: string, meta?: LogMeta): void
  info(event: string, meta?: LogMeta): void
  warn(event: string, meta?: LogMeta): void
  /** `cause` is serialized (name/code/stack), scrubbed, and length-capped */
  error(event: string, cause?: unknown, meta?: LogMeta): void
}

/** Where the file transport writes; the diagnostics IPC reads from here too. */
export function logsDir(): string {
  return join(app.getPath('userData'), 'logs')
}

// Defense in depth: every message passes through here before any transport
// writes it, including ones we don't author (electron-updater internals,
// uncaught exceptions), so home-dir/username scrubbing can't be bypassed.
function scrubValue(value: unknown): unknown {
  if (typeof value === 'string') return scrubText(value)
  if (value instanceof Error) return serializeError(value)
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, typeof v === 'string' ? scrubText(v) : v])
    )
  }
  return value
}

export function initLogging(): void {
  // pin to userData/logs on every platform: electron-log's macOS default
  // (~/Library/Logs) would ignore the dev-paths userData redirect and mix dev
  // logs into the daily driver's
  log.transports.file.resolvePathFn = () => join(logsDir(), 'main.log')
  // local-first guarantee, stated in code: no network, no cross-process mirror
  log.transports.remote.level = false
  log.transports.ipc.level = false
  log.hooks.push((message) => ({ ...message, data: message.data.map(scrubValue) }))
  log.errorHandler.startCatching({ showDialog: false })
  log.info('app.start', {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    packaged: app.isPackaged
  })
}

function line(event: string, meta?: LogMeta, detail?: string): unknown[] {
  const out: unknown[] = [event]
  if (meta !== undefined) out.push(meta)
  if (detail !== undefined) out.push(detail)
  return out
}

export function createLogger(scope: string): Logger {
  const scoped = log.scope(scope)
  return {
    debug: (event, meta) => scoped.debug(...line(event, meta)),
    info: (event, meta) => scoped.info(...line(event, meta)),
    warn: (event, meta) => scoped.warn(...line(event, meta)),
    error: (event, cause, meta) =>
      scoped.error(...line(event, meta, cause === undefined ? undefined : serializeError(cause)))
  }
}
