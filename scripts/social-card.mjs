// The 1280x640 card GitHub shows as the repo's social preview and rafe.dev
// uses as its og:image: the pitch beside the chat answering with a chart.
import { readFileSync } from 'node:fs'
import sharp from 'sharp'

const dataUrl = (bytes, type) => `data:${type};base64,${Buffer.from(bytes).toString('base64')}`

// the conversation column of the 1280x800 @2x chat shot, from the question
// bubble down to the end of the answer; retune if the chat layout moves
const CHAT_CROP = { left: 860, top: 96, width: 1360, height: 940 }

export async function socialCard(browser, chatPng) {
  const font = readFileSync(
    'node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2'
  )
  const logo = readFileSync('docs/logo.png')
  const chat = await sharp(chatPng).extract(CHAT_CROP).png().toBuffer()

  const page = await browser.newPage({ viewport: { width: 1280, height: 640 } })
  await page.setContent(`<!doctype html>
<style>
  @font-face {
    font-family: Geist;
    src: url(${dataUrl(font, 'font/woff2')}) format('woff2');
    font-weight: 100 900;
  }
  * { margin: 0; box-sizing: border-box; }
  body {
    position: relative;
    width: 1280px;
    height: 640px;
    overflow: hidden;
    font-family: Geist, sans-serif;
    color: #0c1a14;
    background:
      radial-gradient(60% 80% at 8% 100%, rgb(116 240 138 / 0.55), transparent 70%),
      radial-gradient(50% 70% at 30% 0%, rgb(111 214 206 / 0.45), transparent 70%),
      radial-gradient(60% 90% at 100% 20%, rgb(110 196 232 / 0.4), transparent 70%),
      #f2fbf5;
  }
  .copy { position: absolute; left: 72px; top: 76px; width: 480px; }
  .brand { display: flex; align-items: center; gap: 16px; font-size: 32px; font-weight: 600; letter-spacing: -0.02em; }
  .brand img { width: 64px; height: 64px; }
  h1 { margin-top: 44px; font-size: 54px; line-height: 1.06; font-weight: 650; letter-spacing: -0.035em; }
  p { max-width: 440px; margin-top: 24px; font-size: 23px; line-height: 1.4; color: #34463d; }
  .platforms { position: absolute; left: 72px; bottom: 64px; font-size: 19px; font-weight: 500; color: #4b5d54; }
  .chat {
    position: absolute;
    right: 56px;
    top: 106px;
    width: 620px;
    border-radius: 16px;
    background: white;
    box-shadow: 0 0 0 1px rgb(12 26 20 / 0.08), 0 24px 70px rgb(12 60 40 / 0.22);
  }
</style>
<div class="copy">
  <div class="brand"><img src="${dataUrl(logo, 'image/png')}" />shmoney</div>
  <h1>Personal finance that never leaves your computer.</h1>
  <p>Budgets, goals, reports, and bank sync in one local SQLite file. Even the AI runs on your device.</p>
</div>
<div class="platforms">Windows · macOS · Linux</div>
<img class="chat" src="${dataUrl(chat, 'image/png')}" />`)
  await page.evaluate(() => document.fonts.ready)
  const png = await page.screenshot()
  await page.close()
  return png
}
