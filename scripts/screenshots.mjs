// Shoots every named demo screen (src/demo/screens.ts) from the built web demo
// with the household dataset, so the README, rafe.dev and the live demo all
// show the same build and the same data.
//
//   npm run build:demo && npm run screenshots                  -> docs/screenshots/*.png
//   npm run screenshots -- --out out/demo/screenshots --web    -> + AVIF/WebP for the web
//
// Drives the installed Chrome (SCREENSHOT_BROWSER=msedge for Edge) through
// playwright-core, so there is no browser download.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright-core'
import sharp from 'sharp'
import { preview } from 'vite'

const { values } = parseArgs({
  options: {
    out: { type: 'string', default: 'docs/screenshots' },
    web: { type: 'boolean', default: false },
    only: { type: 'string' }
  }
})
const outDir = resolve(values.out)
mkdirSync(outDir, { recursive: true })

// the size rafe.dev embeds the live demo at, so a screenshot standing in for
// an embed that hasn't booted yet swaps for it without a shift
const VIEWPORT = { width: 1280, height: 800 }
const SCALE = 2
// the Windows 11 window corner, in CSS pixels
const RADIUS = 8
const WEB_WIDTHS = [640, 960, 1280, 1920]

const server = await preview({ configFile: 'vite.demo.config.ts', preview: { port: 0 } })
const base = server.resolvedUrls.local[0]
const browser = await chromium.launch({ channel: process.env.SCREENSHOT_BROWSER ?? 'chrome' })

try {
  const screens = await (await fetch(new URL('screens.json', base))).json()
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
    colorScheme: 'light',
    reducedMotion: 'reduce'
  })
  const manifest = []

  for (const screen of screens) {
    if (values.only && screen.name !== values.only) continue
    const page = await context.newPage()
    await page.goto(`${base}?dataset=household&theme=light&shot=1#${screen.route}`)
    await page.waitForLoadState('networkidle')
    await page.evaluate(() => document.fonts.ready)
    if (screen.scrollTo) {
      await page
        .getByRole('heading', { name: screen.scrollTo })
        .or(page.getByText(screen.scrollTo, { exact: true }))
        .first()
        .evaluate((el) => {
          // bring the card holding the heading flush with the top of the page
          const card = el.closest('[data-slot=card]') ?? el
          card.scrollIntoView({ block: 'start' })
        })
    }
    // chart entry animations and lazy route chunks settle well inside this
    await page.waitForTimeout(1500)
    // rounded corners, transparent outside them, like a real window
    await page.addStyleTag({
      content: `html { clip-path: inset(0 round ${RADIUS}px); background: transparent !important; }`
    })

    const png = await page.screenshot({ omitBackground: true, animations: 'disabled' })
    writeFileSync(join(outDir, `${screen.name}.png`), png)

    if (values.web) {
      for (const width of WEB_WIDTHS) {
        const resized = sharp(png).resize({ width })
        await resized
          .clone()
          .avif({ quality: 60 })
          .toFile(join(outDir, `${screen.name}-${width}.avif`))
        await resized
          .clone()
          .webp({ quality: 80 })
          .toFile(join(outDir, `${screen.name}-${width}.webp`))
      }
    }
    manifest.push({
      name: screen.name,
      width: VIEWPORT.width * SCALE,
      height: VIEWPORT.height * SCALE,
      widths: values.web ? WEB_WIDTHS : []
    })
    await page.close()
    process.stdout.write(`shot ${screen.name}\n`)
  }

  if (values.web) {
    writeFileSync(join(outDir, 'screenshots.json'), JSON.stringify(manifest, null, 2))
  }
} finally {
  await browser.close()
  await new Promise((done) => server.httpServer.close(done))
}
