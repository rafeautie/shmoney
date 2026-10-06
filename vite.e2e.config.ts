import { resolve } from 'node:path'
import { normalizePath, type Plugin } from 'vite'
import demo from './vite.demo.config'

// The web demo built for the UI tests: identical except the on-device model is
// a scriptable stand-in (src/demo/e2e/llm-manager.ts) that also exposes
// window.__shmoney. Output stays out of the published demo.

const SCRIPTED = normalizePath(resolve('src/demo/e2e/llm-manager.ts'))
const MANAGERS = new Set(
  ['src/main/llm/manager.ts', 'src/demo/llm-manager.ts'].map((p) => normalizePath(resolve(p)))
)

function scriptedModel(): Plugin {
  return {
    name: 'shmoney-e2e-model',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || !source.startsWith('.') || normalizePath(importer) === SCRIPTED) return null
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      return resolved && MANAGERS.has(normalizePath(resolved.id)) ? SCRIPTED : null
    }
  }
}

export default {
  ...demo,
  plugins: [scriptedModel(), ...(demo.plugins ?? [])],
  build: { ...demo.build, outDir: resolve('out/e2e') },
  server: { port: 5175 },
  preview: { port: 5175 }
}
