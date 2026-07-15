# Contributing to shmoney

Thanks for your interest in contributing! Bug reports, feature ideas, and pull requests are all welcome.

## Development setup

You need Node.js 22+ and npm. Native modules (better-sqlite3, node-llama-cpp) are rebuilt for Electron automatically on install.

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
| `npm run lint` | ESLint over the whole repo (CI requires zero warnings) |
| `npm run test` | Run the vitest suite |
| `npm run db:generate` | Generate a drizzle migration after editing `src/main/db/schema.ts` |
| `npm run build:unpack` | Production build without packaging an installer |

## Before opening a PR

- Run `npm run typecheck`, `npm run lint`, and `npm run test` — CI enforces all three.
- Keep PRs focused; unrelated refactors make review slower.
- For anything user-visible, a short before/after description (or screenshot) helps a lot.
- Database schema changes need a generated migration in `drizzle/` — never edit an existing migration.

## Reporting bugs and requesting features

Open a [GitHub issue](https://github.com/rafeautie/shmoney/issues). For bugs, include your OS, the app version (Settings → About), and steps to reproduce. **Never attach your database file or SimpleFIN credentials to an issue.**

## Contribution license terms

shmoney is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE.md). So that the project remains maintainable under one set of terms, contributions are accepted under the following grant:

By submitting a contribution (code, documentation, or other material) to this repository, you agree that:

1. You have the right to submit the contribution and it is your original work (or you have the right to submit it).
2. You grant the project maintainer a perpetual, worldwide, non-exclusive, irrevocable, royalty-free license to use, reproduce, modify, distribute, sublicense, and relicense your contribution as part of the project, including under licenses other than the current project license.
3. You retain the copyright to your contribution; this is a license grant, not a copyright transfer.

If you cannot or do not want to agree to these terms, please open an issue describing the change instead of a pull request.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Be kind.
