# Sampo

Sampo is a local-first macOS desktop application for analysing personal finances. It currently has a secure Electron/Vue shell, the local persistence/domain foundation, tested main-process EVO/Bankinter Visa XLS and account PDF importers, and tested main-process Visa settlement reconciliation. Import UI, dashboards, reconciliation UI, categorisation, subscriptions, and AI features are planned but not implemented.

## Stack

- Electron, electron-vite, Vite
- Vue 3, Vue Router, Pinia
- TypeScript, Zod
- SQLite through `better-sqlite3` in the Electron main process
- `@e965/xlsx` for legacy BIFF `.xls` Visa workbook parsing
- `pdfjs-dist` for text-based account statement PDF extraction
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

## Current Limitations

- No import preview UI
- No dashboards or transaction analysis
- No reconciliation UI
- No categorisation or subscription detection
- No own-account transfer detection or fuzzy/partial reconciliation
- No AI analysis
- No OCR, image-only PDF import, encrypted PDF import, or unsupported changed-layout PDF import
- No signing, notarisation, auto-update, telemetry, or cloud synchronisation

## Documentation

- [Product](docs/PRODUCT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Data model](docs/DATA_MODEL.md)
- [Import rules](docs/IMPORT_RULES.md)
- [Roadmap](docs/ROADMAP.md)
