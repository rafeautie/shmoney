import { z } from 'zod'

/**
 * One renderer log line, forwarded over the curated bridge into the main
 * process's log file. `detail` is free text (error stacks); the main logger
 * scrubs home-dir paths and caps length before anything is written.
 */
export const logWriteSchema = z.object({
  level: z.enum(['info', 'warn', 'error']),
  event: z.string().min(1).max(200),
  detail: z.string().max(8000).optional()
})
export type LogWriteInput = z.infer<typeof logWriteSchema>

export const LOG_IPC = {
  write: 'log:write'
} as const

export const DIAGNOSTICS_IPC = {
  /** the diagnostics text: app/system info + recent log lines */
  get: 'diagnostics:get',
  /** copy the previewed text to the clipboard, byte for byte */
  copy: 'diagnostics:copy',
  openLogsFolder: 'diagnostics:openLogsFolder'
} as const
