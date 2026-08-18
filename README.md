# Sampo

Sampo is a local-first macOS desktop application for analysing personal finances. It currently has a secure Electron/Vue shell, the local persistence/domain foundation, tested EVO/Bankinter Visa XLS and account PDF importers, exact Visa settlement reconciliation, a usable import/reconciliation UI workflow, deterministic transaction categorisation with merchant aliases and user-approved rules, optional AI categorisation suggestions, and deterministic recurring-payment candidates. Dashboards, charts, forecasting, and broader analysis remain planned.

## Stack

- Electron, electron-vite, Vite
- Vue 3, Vue Router, Pinia
- TypeScript, Zod
- SQLite through `better-sqlite3` in the Electron main process
- `@e965/xlsx` for legacy BIFF `.xls` Visa workbook parsing
- `pdfjs-dist` for text-based account statement PDF extraction
- OpenAI Responses API for optional descriptor-only categorisation suggestions
- npm, Vitest, ESLint, Prettier
- electron-builder for personal macOS packaging

## Prerequisites

- Node.js compatible with current electron-vite requirements: `20.19+` or `22.12+`
- npm
- macOS for the first packaging target

## Development

Install dependencies:

```sh
npm install
```

Run the desktop app in development:

```sh
npm run dev
```

For disposable manual import testing, run the app with a development-only database path:

```sh
SAMPO_DATABASE_PATH=/tmp/sampo-dev.sqlite3 npm run dev
```

Production builds continue to use `app.getPath('userData')/sampo.sqlite3`.

Run quality checks:

```sh
npm run typecheck
npm run lint
npm run format:check
npm run test:run
```

Build production bundles:

```sh
npm run build
```

Create a personal macOS package:

```sh
npm run package:mac
```

Distributable artifacts are written to `release/`. Electron production build output is written to `out/`.

## Privacy

Sampo is designed for local financial data. Do not place real bank statements, Visa exports, SQLite databases, or other genuine financial files inside this repository.

The application database is local-only at `app.getPath('userData')/sampo.sqlite3`. Tests use explicitly supplied temporary database paths and must never open the real application database.

AI categorisation is optional and disabled by default. When enabled, Sampo sends normalised transaction descriptors and category context to OpenAI for suggestions only; it does not send amounts, balances, account identifiers, full source files, or API keys back to the renderer. OpenAI response storage is disabled in provider requests, and web lookup is an explicit separate setting.

## Current Limitations

- No dashboards or transaction analysis
- No reconciliation review polish beyond the Phase 5 workflow
- No recurring spend dashboard or upcoming-payment forecasting
- No charts or financial insights
- No own-account transfer detection or fuzzy/partial reconciliation
- AI is limited to optional merchant/category suggestions and is never authoritative financial data
- No OCR, image-only PDF import, encrypted PDF import, or unsupported changed-layout PDF import
- No signing, notarisation, auto-update, telemetry, or cloud synchronisation

## Documentation

- [Product](docs/PRODUCT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Data model](docs/DATA_MODEL.md)
- [Import rules](docs/IMPORT_RULES.md)
- [Roadmap](docs/ROADMAP.md)
