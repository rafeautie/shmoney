import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'
import { defineConfig, normalizePath, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { SCREENS } from './src/demo/screens'

// The web demo: the real renderer, preload and main-process IPC handlers built
// into one static page. Electron, Node and the on-device model are swapped for
// browser stand-ins at the module boundary; nothing else is forked.

const version = (createRequire(import.meta.url)('./package.json') as { version: string }).version

const shim = (file: string): string => normalizePath(resolve('src/demo/shims', file))

// app modules replaced by path, however they're imported (the main process
// imports these relatively, so a bare-specifier alias can't catch them)
const REDIRECTS = new Map(
  [
    ['src/main/db/index.ts', 'src/demo/db.ts'],
    ['src/main/logging/index.ts', 'src/demo/shims/logging.ts'],
    ['src/main/llm/manager.ts', 'src/demo/llm-manager.ts'],
    ['src/main/access-url.ts', 'src/demo/shims/access-url.ts']
  ].map(([from, to]) => [normalizePath(resolve(from)), normalizePath(resolve(to))])
)

function redirectAppModules(): Plugin {
  return {
    name: 'shmoney-demo-redirects',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || !source.startsWith('.')) return null
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      return (resolved && REDIRECTS.get(normalizePath(resolved.id))) ?? null
    }
  }
}

function commit(): string | null {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return null
  }
}

function manifests(): Plugin {
  return {
    name: 'shmoney-demo-manifests',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ version, commit: commit() }, null, 2)
      })
      // hosts and the screenshot script address screens by name through this
      this.emitFile({
        type: 'asset',
        fileName: 'screens.json',
        source: JSON.stringify(SCREENS, null, 2)
      })
    }
  }
}

export default defineConfig({
  root: resolve('src/demo'),
  base: './',
  publicDir: resolve('src/demo/public'),
  define: {
    __APP_VERSION__: JSON.stringify(version),
    'import.meta.env.VITE_SHMONEY_DEMO': JSON.stringify('1'),
    'process.platform': JSON.stringify('web'),
    'process.versions': '{}'
  },
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@main': resolve('src/main'),
      '@shared': resolve('src/shared'),
      '@': resolve('src/renderer/src'),
      electron: shim('electron.ts'),
      '@electron-toolkit/utils': shim('toolkit-utils.ts'),
      'node:crypto': shim('node-crypto.ts'),
      'node:fs': shim('node-fs.ts'),
      'node:path': shim('node-path.ts')
    }
  },
  plugins: [
    redirectAppModules(),
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      routesDirectory: resolve('src/renderer/src/routes'),
      generatedRouteTree: resolve('src/renderer/src/routeTree.gen.ts')
    }),
    react(),
    manifests()
  ],
  build: {
    outDir: resolve('out/demo'),
    emptyOutDir: true,
    target: 'es2022'
  },
  server: { port: 5174 },
  preview: { port: 5174 }
})
