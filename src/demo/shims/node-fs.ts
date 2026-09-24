import { takePicked } from './files'

export function readFileSync(path: string): Uint8Array {
  return takePicked(path)
}

export default { readFileSync }
