/** The readable part of an error; IPC rejections wrap it in "Error invoking remote method ..." */
export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
}

export function logRenderError(event: string, error: unknown): void {
  const detail = error instanceof Error ? (error.stack ?? String(error)) : String(error)
  window.api.log.write({ level: 'error', event, detail: detail.slice(0, 8000) })
}
