// nothing to protect in the demo: its only access URLs are `demo:` tokens

export const encryptAccessUrl = (accessUrl: string): string => accessUrl
export const decryptAccessUrl = (stored: string): string => stored
export const canEncryptAccessUrl = (): boolean => true
