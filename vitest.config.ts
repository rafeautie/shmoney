import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// tests run outside electron-vite, so its aliases must be redeclared here
export default defineConfig({
  resolve: {
    alias: {
      '@main': resolve('src/main'),
      '@shared': resolve('src/shared')
    }
  }
})
