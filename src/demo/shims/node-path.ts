export function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function join(...parts: string[]): string {
  return parts.join('/')
}

export default { basename, join }
