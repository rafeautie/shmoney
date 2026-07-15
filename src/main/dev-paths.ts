import fs from 'node:fs'
import { app } from 'electron'

// dev gets its own userData dir (the database, LLM models, caches, and the
// single-instance lock all live under it), so a packaged install can be
// daily-driven alongside development on the same machine. This module must be
// the entry module's first import: imports are hoisted, and db/index.ts opens
// the database at import time, so setting the path any later is too late.
// Electron only creates the dir at app-ready — after the db has opened — so
// create it here too.
if (!app.isPackaged) {
  const devDir = `${app.getPath('userData')}-dev`
  fs.mkdirSync(devDir, { recursive: true })
  app.setPath('userData', devDir)
}
