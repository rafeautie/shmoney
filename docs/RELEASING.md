# Releasing

Releases are built and published to GitHub Releases by CI when a version tag is pushed. Installed apps check for updates on launch and every 4 hours, download silently, and prompt for a restart with a blue dot on Settings.

## Cutting a release

1. `npm run release:patch` (or `release:minor` / `release:major`) bumps package.json, commits, creates the `vX.Y.Z` tag, and pushes with `--follow-tags`. The tag must match package.json; CI fails fast on drift.
2. CI (`.github/workflows/release.yml`) runs three jobs off the tag:
   - **draft** creates one draft release up front, so the platform builds upload into the same draft instead of racing to create their own.
   - **release** builds on Windows, macOS and Linux in parallel and uploads to that draft: `shmoney-X.Y.Z-setup.exe` with its `.blockmap` and `latest.yml`; `shmoney-X.Y.Z.dmg`; `shmoney-X.Y.Z.AppImage` with `latest-linux.yml`, plus a `.deb`.
   - **demo** builds the web demo, reshoots the web screenshots from it, deploys to shmoney-demo.rafe.dev (needs the `CLOUDFLARE_API_TOKEN` secret), and checks the deploy serves its screenshots, since rafe.dev loads them from there.
3. Sanity-check the draft's artifacts on GitHub, then click **Publish release**. Updaters ignore drafts, so nothing ships until this step. The demo is the exception: it deploys as soon as its job passes.

Installed apps pick the release up on next launch or within 4 hours. If the user ignores the Restart prompt, the update still installs on the next normal quit.

The README screenshots in `docs/screenshots` are not part of the release; reshoot them with `npm run build:demo && npm run screenshots` when the UI they show changes.

## Platform notes

- Automatic updates cover Windows and Linux (AppImage and `.deb`, both read `latest-linux.yml`; the `.deb` update asks for an admin password to install).
- macOS auto-update requires a code-signed app (Apple Developer ID), which this project doesn't have. Mac builds instead check the latest published GitHub release on the same schedule and, when it's newer and has a `.dmg`, show a **Download update** button on Settings → About (plus the Settings dot) linking to the release page. The dmg is ad-hoc signed so Apple Silicon doesn't report it as damaged; Gatekeeper still warns on first open.
- Builds are unsigned: SmartScreen warns on the first manually downloaded install, but electron-updater's own downloads update silently afterwards.
- Windows updates download only changed blocks (blockmap differential), so update downloads are much smaller than the full installer despite the bundled llama binaries.

## Testing the update flow in dev

The updater normally only runs in packaged builds. To exercise the full flow (check → download progress on the Settings page → blue Settings dot → Restart) without publishing:

1. Create a git-ignored `dev-app-update.yml` in the project root:

   ```yaml
   provider: generic
   url: http://127.0.0.1:8081
   ```

2. Build once (`npm run build:win`) and copy `dist/latest.yml`, the setup exe, and its `.blockmap` into a folder. Edit that `latest.yml`'s `version` to be higher than package.json's if needed.
3. Serve the folder: `npx serve -l 8081 <folder>`
4. Run the app with the escape hatch: `$env:SHMONEY_TEST_UPDATES = '1'; npm run dev`
