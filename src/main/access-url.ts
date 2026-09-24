import { safeStorage } from 'electron'

// the SimpleFIN access URL embeds credentials, so it only ever rests encrypted
// by the OS keychain; the web demo swaps this module for a plaintext one

export function encryptAccessUrl(accessUrl: string): string {
  return safeStorage.encryptString(accessUrl).toString('base64')
}

export function decryptAccessUrl(stored: string): string {
  return safeStorage.decryptString(Buffer.from(stored, 'base64'))
}

export function canEncryptAccessUrl(): boolean {
  return safeStorage.isEncryptionAvailable()
}
