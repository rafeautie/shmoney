# Releasing

Releases are built and published to GitHub Releases by CI when a version tag is pushed. Installed apps check for updates on launch and every 4 hours, download silently, and prompt for a restart via the notification center.

## Cutting a release

1. `npm version patch` (or `minor` / `major`) — bumps package.json, commits, and creates the `vX.Y.Z` tag. The tag must match package.json; CI fails fast on drift.
2. `git push --follow-tags`
3. CI (`.github/workflows/release.yml`) builds the Windows installer and uploads `shmoney-X.Y.Z-setup.exe`, its `.blockmap`, and `latest.yml` to a **draft** release.
4. Sanity-check the draft's artifacts on GitHub, then click **Publish release**. Updaters ignore drafts, so nothing ships until this step.

Installed apps pick the release up on next launch or within 4 hours. If the user ignores the Restart prompt, the update still installs on the next normal quit.

## Platform notes

- Windows only for now. macOS auto-update requires a code-signed app (Apple Developer ID), which this project doesn't have; a Linux job is easy to add if there's ever an audience.
- Builds are unsigned: SmartScreen warns on the first manually downloaded install, but electron-updater's own downloads update silently afterwards.
- Updates download only changed blocks (blockmap differential), so update downloads are much smaller than the full installer despite the bundled llama binaries.

## Testing the update flow in dev

The updater normally only runs in packaged builds. To exercise the full flow (check → progress job in the notification center → "Update ready" → Restart) without publishing:

1. Create a git-ignored `dev-app-update.yml` in the project root:

   ```yaml
   provider: generic
   url: http://127.0.0.1:8081
   ```

2. Build once (`npm run build:win`) and copy `dist/latest.yml`, the setup exe, and its `.blockmap` into a folder. Edit that `latest.yml`'s `version` to be higher than package.json's if needed.
3. Serve the folder: `npx serve -l 8081 <folder>`
4. Run the app with the escape hatch: `$env:SHMONEY_TEST_UPDATES = '1'; npm run dev`
