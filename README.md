<p align="center">
  <img src="docs/logo.png" width="120" alt="shmoney logo" />
</p>

<h1 align="center">shmoney</h1>

<p align="center">
  <img alt="badge" src="https://shieldcn.dev/badge/SQLite.svg?size=xs&amp;font=geist&amp;logo=sqlite&amp;logoColor=ffffff&amp;color=1a493b&amp;gap=7">
  <picture><source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/badge/Gemma%204%20E2B.svg?size=xs&amp;theme=blue&amp;font=geist&amp;logo=ri%3AFaGoogle&amp;logoColor=ffffff&amp;gap=7&amp;mode=dark"><img alt="badge" src="https://shieldcn.dev/badge/Gemma%204%20E2B.svg?size=xs&amp;theme=blue&amp;font=geist&amp;logo=ri%3AFaGoogle&amp;logoColor=ffffff&amp;gap=7&amp;mode=light"></picture>
  <picture><source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/badge/Secure%20&amp;%20Private.svg?size=xs&amp;theme=rose&amp;font=geist&amp;logo=lu%3ALock&amp;logoColor=ffffff&amp;gap=8&amp;mode=dark"><img alt="badge" src="https://shieldcn.dev/badge/Secure%20&amp;%20Private.svg?size=xs&amp;theme=rose&amp;font=geist&amp;logo=lu%3ALock&amp;logoColor=ffffff&amp;gap=8&amp;mode=light"></picture>
</p>

<p align="center">
    <img alt="badge" src="https://shieldcn.dev/badge/Windows.svg?variant=destructive&amp;size=xs&amp;font=geist&amp;split=true&amp;logo=ri%3AFaWindows&amp;logoColor=3f89ff&amp;valueColor=ffffff&amp;labelTextColor=f8f8f8&amp;gap=0">
  <img alt="badge" src="https://shieldcn.dev/badge/MacOS.svg?variant=destructive&amp;size=xs&amp;font=geist&amp;split=true&amp;logo=apple&amp;logoColor=ffffff&amp;valueColor=ffffff&amp;labelTextColor=f8f8f8&amp;gap=0">
  <img alt="badge" src="https://shieldcn.dev/badge/Linux.svg?variant=destructive&amp;size=xs&amp;font=geist&amp;split=true&amp;logo=ri%3APiLinuxLogo&amp;logoColor=ffffff&amp;valueColor=E95420&amp;labelTextColor=E95420&amp;gap=0">
</p>

<p align="center">
<a href="https://github.com/rafeautie/shmoney/releases"><picture><source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/github/rafeautie/shmoney/release.svg?mode=dark"><img alt="badge" src="https://shieldcn.dev/github/rafeautie/shmoney/release.svg?mode=light"></picture></a>
  <a href="https://github.com/rafeautie/shmoney/actions"><picture><source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/github/rafeautie/shmoney/ci.svg?size=xs&amp;font=geist&amp;mode=dark"><img alt="badge" src="https://shieldcn.dev/github/rafeautie/shmoney/ci.svg?size=xs&amp;font=geist&amp;mode=light"></picture></a>
</p>

shmoney is a local-first personal finance app for the desktop. It tracks your accounts, transactions, budgets, and investments in a single SQLite database on your own machine. There is no cloud backend, no user account, and no telemetry.

It is built for people who want a full-featured finance tracker without handing their bank credentials or transaction history to a hosted service. Bank data comes in through [SimpleFIN](https://www.simplefin.org/) or plain file imports, and everything else, including AI categorization, runs entirely on your device.

Built with Electron, React, TypeScript, and SQLite. Runs on Windows, macOS, and Linux.

## ✨ Features

- 🏦 **Bank sync via SimpleFIN.** Pull balances, transactions, and investment holdings without handing over bank credentials.
- 📄 **File import.** CSV, TSV, OFX, QFX, and QIF, with column mapping and duplicate detection.
- 🤖 **On-device AI categorization.** An optional local LLM (via llama.cpp) categorizes transactions, fully offline.
- ⚡ **Rules engine.** Prioritized rules run on every sync; the app suggests new ones from how you categorize.
- ✉️ **Envelope budgeting.** Assign monthly amounts to category envelopes and track what remains.
- 📊 **Custom reports.** Drag-and-drop dashboards with chart, table, and stat widgets, plus saved filters.
- 🔁 **Transfer detection.** Money moved between your own accounts is excluded from income and spending.
- ↩️ **Activity log with undo.** Every change is recorded and reversible, even across restarts.
- 📈 **Investments and net worth.** Holdings with market value and cost basis, and per-currency net worth.

## 🔜 Coming soon

- 🇪🇺 **European bank sync.** Connect to European banks alongside SimpleFIN.

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

Bug reports and feature requests are welcome via [GitHub issues](https://github.com/rafeautie/shmoney/issues); see [CONTRIBUTING.md](CONTRIBUTING.md). Pull requests are not accepted. Security issues should go through [private vulnerability reporting](SECURITY.md) instead of public issues.

## 📜 License

shmoney is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE.md). You are free to use, modify, and share it for any noncommercial purpose; commercial use is not permitted. If you are interested in a commercial license, open an issue.

The shmoney name and logo are not covered by the license: forks and derived works must use a different name and logo.
