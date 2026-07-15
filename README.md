<p align="center">
  <img src="docs/logo.png" width="120" alt="shmoney logo" />
</p>

<h1 align="center">shmoney</h1>

<p align="center">
  <img alt="Electron" src="https://img.shields.io/badge/Electron-2B2E3A?logo=electron&logoColor=9FEAF9" />
  <img alt="React 19" src="https://img.shields.io/badge/React_19-20232A?logo=react&logoColor=61DAFB" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white" />
  <img alt="SQLite" src="https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white" />
  <img alt="llama.cpp" src="https://img.shields.io/badge/llama.cpp-local_AI-8A2BE2" />
  <img alt="Platforms" src="https://img.shields.io/badge/Windows_%7C_macOS_%7C_Linux-31C48D" />
</p>

shmoney is a local-first personal finance app for the desktop. It tracks your accounts, transactions, budgets, and investments in a single SQLite database on your own machine. There is no cloud backend, no user account, and no telemetry.

It is built for people who want a full-featured finance tracker without handing their bank credentials or transaction history to a hosted service. Bank data comes in through [SimpleFIN](https://www.simplefin.org/) or plain file imports, and everything else, including AI categorization, runs entirely on your device.

Built with Electron, React, TypeScript, and SQLite. Runs on Windows, macOS, and Linux.

## ✨ Features

- 🏦 **Bank sync via SimpleFIN.** Connect with a SimpleFIN token to pull balances, transactions, and investment holdings from your institutions. Sync is idempotent: it never overwrites your categories or resurrects deleted rows, and amounts are stored as integer milliunits to avoid floating-point errors.
- 📄 **File import.** Import CSV, TSV, OFX, QFX, or QIF exports into manual accounts, with column mapping and duplicate detection. Imported transactions go through the same rules and categorization as synced ones.
- 🤖 **On-device AI categorization.** An optional local LLM (via llama.cpp) categorizes transactions that rules do not cover. The model is downloaded once from Settings and runs offline. Output is grammar-constrained to valid category IDs, and every run is cancellable and undoable.
- ⚡ **Rules engine.** Rules match on description, amount, direction, account, and date, and run in priority order on every sync. The app also suggests new rules based on how you categorize manually.
- ✉️ **Envelope budgeting.** Assign monthly amounts to category envelopes and track what remains as you spend.
- 📊 **Custom reports.** Drag-and-drop dashboards built from chart, table, and stat widgets, with filtering by date, account, category, direction, amount, and text search. Filters can be saved and reused.
- 🔁 **Transfer detection.** Equal-and-opposite transactions between your own accounts within a 3-day window are paired and excluded from income and spending totals. Only unambiguous 1:1 matches are marked.
- ↩️ **Activity log with undo.** Every mutation, whether manual, from a rule, from the AI, or from a detector, is recorded and reversible, including across restarts.
- 📈 **Investments and net worth.** Per-account holdings with market value and cost basis, and a net worth summary across all accounts, per currency.

## 🔒 Privacy and data

- All application data lives in a SQLite file in your OS user-data directory. You can back it up, move it, or inspect it with any SQLite tool.
- SimpleFIN credentials are encrypted using the OS keychain and never leave the Electron main process.
- The only network calls the app makes are to your SimpleFIN bridge and the one-time LLM model download. There is no telemetry and no cloud sync.

## 🚧 Status

shmoney is under active development and has not reached a stable release. The database schema may change between versions.

## 🛠️ Building from source

You need Node.js 22+ and npm.

```bash
git clone https://github.com/rafeautie/shmoney.git
cd shmoney
npm install
npm run dev          # development app with hot reload
npm run build:win    # packaged installer (also build:mac, build:linux)
```

## 🤝 Contributing

Bug reports, ideas, and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Security issues should go through [private vulnerability reporting](SECURITY.md) instead of public issues.

## 📜 License

shmoney is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE.md). You are free to use, modify, and share it for any noncommercial purpose; commercial use is not permitted. If you are interested in a commercial license, open an issue.

The shmoney name and logo are not covered by the license: forks and derived works must use a different name and logo.
