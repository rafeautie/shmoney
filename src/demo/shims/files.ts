// Bridges the import handler's dialog + readFileSync pair onto a browser file
// input: the dialog shim parks the picked file's bytes under a token path, and
// the fs shim hands them back when the handler "reads" that path.

const picked = new Map<string, Uint8Array>()
let next = 0

export function pickFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.csv,.tsv,.ofx,.qfx,.qif'
    input.addEventListener('change', async () => {
      const file = input.files?.[0]
      if (!file) return resolve(null)
      const token = `/picked/${next++}/${file.name}`
      picked.set(token, new Uint8Array(await file.arrayBuffer()))
      resolve(token)
    })
    input.addEventListener('cancel', () => resolve(null))
    input.click()
  })
}

export function takePicked(path: string): Uint8Array {
  const bytes = picked.get(path)
  if (!bytes) throw new Error(`No file at ${path}`)
  picked.delete(path)
  return bytes
}
