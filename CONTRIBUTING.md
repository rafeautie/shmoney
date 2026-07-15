# Contributing to shmoney

Thanks for your interest in the project! shmoney does **not accept pull requests** — it is developed and maintained solely by the project owner. The best way to contribute is by opening a GitHub issue with a bug report or a feature request. PRs will be closed without review.

## Reporting bugs

Open a [GitHub issue](https://github.com/rafeautie/shmoney/issues). Include:

- Your OS and the app version (Settings → About)
- Steps to reproduce the problem
- What you expected to happen vs. what actually happened

**Never attach your database file or SimpleFIN credentials to an issue.** For suspected security problems, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Requesting features

Open a [GitHub issue](https://github.com/rafeautie/shmoney/issues) describing the feature and the problem it solves for you. Concrete use cases help a lot more than abstract proposals. If you've sketched out how it might work, include that too — just note that any implementation happens at the maintainer's discretion.

## Running the app locally

You're welcome to fork the repo and run or modify the app for your own use, subject to the [PolyForm Noncommercial License 1.0.0](LICENSE.md). You need Node.js 22+ and npm. Native modules (better-sqlite3, node-llama-cpp) are rebuilt for Electron automatically on install.

```bash
git clone https://github.com/rafeautie/shmoney.git
cd shmoney
npm install
npm run dev
```

Useful scripts:

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the app with hot reload |
| `npm run typecheck` | Type-check the main/preload and renderer projects |
| `npm run lint` | ESLint over the whole repo (zero warnings required) |
| `npm run test` | Run the vitest suite |
| `npm run db:generate` | Generate a drizzle migration after editing `src/main/db/schema.ts` |
| `npm run build:unpack` | Production build without packaging an installer |

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Be kind.
