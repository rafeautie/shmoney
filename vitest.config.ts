import { resolve } from 'node:path'
import { configDefaults, defineConfig } from 'vitest/config'

// tests run outside electron-vite, so its aliases must be redeclared here
export default defineConfig({
  resolve: {
    alias: {
      '@main': resolve('src/main'),
      '@shared': resolve('src/shared')
    }
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: [...configDefaults.exclude, 'src/**/*.int.test.ts']
        }
      },
      {
        // the real IPC handlers and preload over in-memory SQLite; see
        // src/main/integration/harness/setup.ts
        extends: true,
        test: {
          name: 'integration',
          include: ['src/**/*.int.test.ts'],
          setupFiles: ['src/main/integration/harness/setup.ts'],
          globalSetup: ['src/main/integration/harness/coverage.ts'],
          env: { TZ: 'America/New_York' }
        }
      }
    ]
  }
})
