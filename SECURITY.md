# Security Policy

shmoney is a local-first desktop app that handles financial data, so security reports are taken seriously and are very welcome.

## Supported versions

shmoney has not reached a stable release yet. Only the latest release (and the current `main` branch) receive security fixes.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Instead, use [GitHub private vulnerability reporting](https://github.com/rafeautie/shmoney/security/advisories/new) to file a report. You can expect an acknowledgment within a few days. Please include steps to reproduce and, if you have one, a suggested fix.

If the report is valid, a fix will be developed privately and credited to you in the release notes unless you prefer otherwise.

## Scope notes

Useful context for researchers:

- All application data lives in a local SQLite database; there is no server component, no user accounts, and no telemetry.
- SimpleFIN credentials are encrypted with the OS keychain (`safeStorage`) and only ever decrypted in the Electron main process. They must never be reachable from the renderer.
- The renderer runs sandboxed with context isolation; the only bridge is the curated `window.api` surface, and every IPC handler validates its input with zod.
- The only network calls the app makes are to the user's SimpleFIN bridge and the one-time LLM model download (verified against a pinned SHA-256).

Reports that show a way to break any of these invariants are exactly what this policy is for.
