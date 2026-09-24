import type { Logger, LogMeta } from '../../main/logging'

// the demo has no log file; warnings and errors go to the console
export function createLogger(scope: string): Logger {
  const tag = `[${scope}]`
  return {
    debug: () => {},
    info: () => {},
    warn: (event: string, meta?: LogMeta) => console.warn(tag, event, meta ?? ''),
    error: (event: string, cause?: unknown, meta?: LogMeta) =>
      console.error(tag, event, cause ?? '', meta ?? '')
  }
}

export function logsDir(): string {
  return '/demo/logs'
}
