// Shoots every named demo screen (src/demo/screens.ts) from the built web demo
// with the household dataset, so the README, rafe.dev and the live demo all
// show the same build and the same data.
//
//   npm run build:demo && npm run screenshots                  -> docs/screenshots/*.png
//   npm run screenshots -- --out out/demo/screenshots --web    -> + AVIF/WebP for the web
//
// Also assembles the README's animated tour and the social preview card from
// the same shots.
//
// Drives the installed Chrome (SCREENSHOT_BROWSER=msedge for Edge) through
// playwright-core, so there is no browser download.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright-core'
import sharp from 'sharp'
import { preview } from 'vite'
import { socialCard } from './social-card.mjs'

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
const CORNER_MASK = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${VIEWPORT.width * SCALE}" height="${VIEWPORT.height * SCALE}">` +
    `<rect width="100%" height="100%" rx="${RADIUS * SCALE}" /></svg>`
)
// the README hero: the core screens in turn, ending on chat
const TOUR = ['transactions', 'budget', 'goals', 'report-detail', 'chat']
const TOUR_HOLD_MS = 2500
const TOUR_FADE_FRAMES = 6
const TOUR_FADE_MS = 50

// crossfades each screen into the next, looping back to the first
async function tour(pngs) {
  const frames = await Promise.all(
    pngs.map((png) =>
      sharp(png).resize({ width: VIEWPORT.width }).raw().toBuffer({ resolveWithObject: true })
    )
  )
  const { info } = frames[0]
  const raw = { width: info.width, height: info.height, channels: info.channels }
  const out = []
  const delay = []
  frames.forEach(({ data: from }, i) => {
    out.push(from)
    delay.push(TOUR_HOLD_MS)
    const to = frames[(i + 1) % frames.length].data
    for (let step = 1; step <= TOUR_FADE_FRAMES; step++) {
      const t = step / (TOUR_FADE_FRAMES + 1)
      const mixed = Buffer.alloc(from.length)
      for (let p = 0; p < from.length; p++) mixed[p] = from[p] + (to[p] - from[p]) * t
      out.push(mixed)
      delay.push(TOUR_FADE_MS)
    }
  })
  const inputs = await Promise.all(
    out.map((data) => sharp(data, { raw }).png({ compressionLevel: 0 }).toBuffer())
  )
  // near-lossless, not lossy: the lossy animation encoder skips pixels that
  // changed only slightly between frames, so a crossfade's small steps leave
  // a ghost of the previous screen burned into the next one
  return sharp(inputs, { join: { animated: true } })
    .webp({ nearLossless: true, quality: 20, delay, loop: 0 })
    .toBuffer()
}

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
  const shots = new Map()

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
    const shot = await page.screenshot({ animations: 'disabled' })
    // rounded corners, transparent outside them, like a real window; masked
    // here because a CSS clip-path on the root misses composited layers like
    // the page's scroll area, leaving the right-hand corners square
    const png = await sharp(shot)
      .ensureAlpha()
      .composite([{ input: CORNER_MASK, blend: 'dest-in' }])
      .png()
      .toBuffer()
    writeFileSync(join(outDir, `${screen.name}.png`), png)
    shots.set(screen.name, png)

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

  if (TOUR.every((name) => shots.has(name))) {
    writeFileSync(join(outDir, 'tour.webp'), await tour(TOUR.map((name) => shots.get(name))))
    process.stdout.write(`shot tour\n`)
  }
  // GitHub's social preview (uploaded by hand) and rafe.dev's og:image
  if (shots.has('chat')) {
    writeFileSync(join(outDir, 'social.png'), await socialCard(browser, shots.get('chat')))
    process.stdout.write(`shot social\n`)
  }

  if (values.web) {
    writeFileSync(join(outDir, 'screenshots.json'), JSON.stringify(manifest, null, 2))
  }
} finally {
  await browser.close()
  await new Promise((done) => server.httpServer.close(done))
}
