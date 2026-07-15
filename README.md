<div align="center">

# shmoney

### Your money, your rules, your machine.

A local-first personal finance app. Every account, every transaction, every chart — in a single SQLite file on your computer. Nothing ever touches a cloud.

![Electron](https://img.shields.io/badge/Electron-2B2E3A?logo=electron&logoColor=9FEAF9)
![React 19](https://img.shields.io/badge/React_19-20232A?logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white)
![Tailwind CSS 4](https://img.shields.io/badge/Tailwind_4-38BDF8?logo=tailwindcss&logoColor=white)
![llama.cpp](https://img.shields.io/badge/llama.cpp-on--device_AI-8A2BE2)

<img src="docs/screenshots/accounts.png" alt="Accounts overview with net worth header" width="850" />

<sub>Screenshots show SimpleFIN demo data, synced and auto-categorized by the app itself.</sub>

</div>

---

## The pitch

Most finance apps want your bank credentials on their servers and your spending history in their analytics pipeline. shmoney takes the opposite bet:

- **Local-first.** All data lives in a SQLite database on your device. No accounts, no telemetry, no cloud backend.
- **Credentials sealed at rest.** Bank access keys are encrypted with your OS keychain and never leave the main process.
- **AI that stays home.** Auto-categorization runs a local LLM via llama.cpp. Your transactions never leave the machine.
- **Everything is undoable.** Every change — yours, a rule's, the AI's — lands in an append-only action log you can review and reverse.

## Features

### One-click bank sync

Connect once with a [SimpleFIN](https://www.simplefin.org/) token and pull balances, transactions, and investment holdings from every institution you use. Sync is idempotent and respectful: it never overwrites your categories, never resurrects deleted rows, and stores amounts as exact integer milliunits so the math is always right.

### File import for everything else

No bank connection? Drop in a CSV, TSV, OFX, QFX, or QIF export and shmoney parses it into a manual account — with column mapping, duplicate detection, and the same rules and AI categorization as synced data.

### On-device AI categorization

Download the model once from Settings (~4 GB) and hit Auto-categorize. Deterministic rules run first for free, then the LLM handles the leftovers. Output is grammar-constrained JSON, so the model can only ever answer with real category IDs. Identical merchants batch into a single generation, and the whole run is cancellable and undoable.

<div align="center">
<img src="docs/screenshots/transactions.png" alt="Transactions table with auto-assigned categories" width="850" />
</div>

<div align="center">
<img src="docs/screenshots/settings-llm.png" alt="Local LLM, categories, and rules in Settings" width="850" />
</div>

### Envelope budgeting

Give every dollar a job. Fill envelopes each month, watch them drain as you spend, and track it all from a dedicated Budget page — plus a budget widget you can pin to any report. Envelope edits are undoable like everything else.

### Dashboards you design

Reports are drag-and-drop grids of widgets: line, bar, area, pie, radar, stat tiles, summary tables, and transaction lists. Filter any report by date, account, category, direction, amount, or search text. Start from the Spending Overview template or build from scratch.

<div align="center">
<img src="docs/screenshots/report-detail.png" alt="Spending Overview report with charts" width="850" />
</div>

### Transfer detection

Money you move between your own accounts is not income or spending. shmoney pairs equal-and-opposite legs across accounts within a 3-day window and excludes them from every total. Only unambiguous 1:1 matches are marked, so your reports never get silently corrupted by a guess.

### A rules engine that compiles to SQL

"If the description contains STARBUCKS, categorize as Dining Out." Rules match on description, amount, direction, account, and date, run in priority order on every sync, and each firing is individually undoable. shmoney even watches how you categorize and suggests new rules when it spots a pattern.

### Full activity history

The Activity page is a flight recorder for your data. Every mutation is grouped by day, badged by its source — manual, rule, AI, detector — and reversible with one click, even across restarts.

<div align="center">
<img src="docs/screenshots/activity.png" alt="Activity page with undo and redo" width="850" />
</div>

### And more

- **Investment holdings** synced per account with market value and cost basis
- **Net worth header** summed across every account, per currency
- **Privacy blur** to hide all amounts when someone is looking over your shoulder
- **Saved filters** reusable across transaction views and reports
- **Light and dark mode** with a polished shadcn/ui interface

## Privacy model

| | |
| --- | --- |
| Your data | SQLite file in your OS user-data folder |
| Bank credentials | Encrypted with the OS keychain, never exported |
| Network calls | Your SimpleFIN bridge, plus a one-time model download |
| Telemetry | None |
| Cloud sync | None, by design |

---

<div align="center">
<sub>Built for people who think a bank statement is nobody's business but their own.</sub>
</div>
