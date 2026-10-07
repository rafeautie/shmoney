// Stands in for the OS keychain (safeStorage). The stored form differs from the
// input, so a spec can assert the access URL never rests in plain text, and
// availability can be switched off to reach the "can't encrypt" branch.

const SEAL = 'sealed:'

export const accessUrlKeychain = { available: true, failDecrypt: false }

export function resetFakeAccessUrl(): void {
  accessUrlKeychain.available = true
  accessUrlKeychain.failDecrypt = false
}

export function encryptAccessUrl(accessUrl: string): string {
  return SEAL + Buffer.from(accessUrl).toString('base64')
}

export function decryptAccessUrl(stored: string): string {
  if (accessUrlKeychain.failDecrypt) throw new Error('Keychain refused to decrypt')
  if (!stored.startsWith(SEAL)) throw new Error('Not a sealed access URL')
  return Buffer.from(stored.slice(SEAL.length), 'base64').toString('utf8')
}

export function canEncryptAccessUrl(): boolean {
  return accessUrlKeychain.available
}
