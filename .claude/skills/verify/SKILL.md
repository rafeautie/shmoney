---
name: verify
description: Drive the shmoney dev app over CDP to verify a change end to end. Use when a change needs runtime observation in the real Electron app (chat, reports, imports, any UI flow).
---

# Verifying shmoney changes in the running app

## Launch

1. Kill any existing dev instance, **node parents first** or electron respawns
   portless and takes the single-instance lock:
   - kill node processes whose command line matches `electron-vite|run dev`
   - then kill every `electron.exe`
2. **Verify ports 5173 and 9222 are actually free before relaunching**
   (`Get-NetTCPConnection -LocalPort 5173,9222 -State Listen`). TaskStop on a
   dev background task does not reliably kill respawned electron-vite
   children; a surviving orphan serves STALE renderer code on 5173 with its
   own 9222, the new instance loses the single-instance lock and silently
   quits, and your driver ends up testing old code (HMR into the orphan then
   produces mixed-version crashes that look like real bugs).
3. Launch from the **Bash tool** (PowerShell's npm swallows the flag into npm
   config instead of passing it through):
   ```bash
   npm run dev -- --remote-debugging-port=9222   # run_in_background
   ```
4. Poll `http://127.0.0.1:9222/json` until the page target appears (~5s).

## Drive

Use a plain Node script over the native WebSocket (no deps): connect to the
page target's `webSocketDebuggerUrl`, then `Runtime.evaluate` with
`awaitPromise + returnByValue`, and `Page.captureScreenshot` for evidence.
A working driver exists at a past job's tmp dir; rewriting it is ~100 lines.

Gotchas that cost time:
- **Hash router**: nav links are `a[href="/#/chat"]` etc. Check
  `location.hash`, not `pathname`. Navigate by `.click()` on the link.
- **Controlled inputs**: set values via the native prototype setter, then
  dispatch `new Event('input', { bubbles: true })`. The chat composer is
  `form textarea`; submit via the form's `button[type="submit"]`.
- **Radix triggers** need `mousedown`, not `click`.
- **electron-vite dev does not rebuild the main process on edit.** Renderer
  changes hot-reload; any `src/main` or `src/preload` change requires a full
  kill + relaunch to take effect.
- Theme and the privacy blur ("Show amounts") persist in the dev profile
  across restarts; check their state before interpreting a screenshot.

## Chat-specific

- The model file must exist at `%APPDATA%\shmoney\models\` (checked at
  `$env:APPDATA\shmoney\models`); the dev DB profile is `shmoney-dev` and
  carries SimpleFIN demo data.
- Streaming detection: the Stop button (`.sr-only` text "Stop") has
  `data-hidden="false"` while a reply generates. Wait for streaming seen →
  gone before reading the settled turn.
- Chat charts carry `data-slot="chat-chart"`; report widgets' Recharts
  containers carry `data-slot="chart"`.
- A full turn takes 20-60s (model load on first turn plus generation);
  poll every ~2.5s with a 280s timeout.

## Production-mode screenshots (README/docs)

A ready-made driver lives in `scripts/` next to this skill: `driver.mjs`
(`targets` / `eval "<js>"` / `shot out.png` subcommands) and
`round-corners.ps1` (`-In -Out -Radius`).

- Launch the shipped UI without dev artifacts: `npm run build`, then
  `npx electron . --remote-debugging-port=9222` from the Bash tool.
  Unpackaged still counts as dev for dev-paths, so it opens the same
  `%APPDATA%\shmoney-dev` profile (demo data, model, settings), but the
  renderer is the built bundle: no Debug nav item, `import.meta.env.DEV`
  false.
- `shot` sizes every capture identically via
  `Emulation.setDeviceMetricsOverride` 1440x900 @2x → 2880x1800 PNG,
  matching the existing `docs/screenshots/`.
- Round to the Windows 11 window radius with
  `round-corners.ps1 -Radius 16` (8px CSS at the 2x capture scale). It
  fills a rounded GraphicsPath with a TextureBrush; `Graphics.SetClip`
  gives jagged corners.
- Screenshot consistency: the chat sidebar history and the notification
  dot appear on every page, so any chat/notification change made
  mid-run means recapturing earlier pages too. Capture chat last, then
  re-shoot anything taken before the transcript reached its final
  state.
- Base UI selects resolve a bare `<SelectValue />` to its label only
  when the `Select` root gets an `items` prop (fixed across the app
  2026-07-17); a trigger showing a raw token like `last-12-months`
  means a new select is missing `items`.
