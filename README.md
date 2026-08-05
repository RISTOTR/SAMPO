# Sampo

Sampo is a local-first macOS desktop application for analysing personal finances. It is currently a secure Electron/Vue foundation only; importers, persistence, dashboards, reconciliation, categorisation, and AI features are planned but not implemented.

## Stack

- Electron, electron-vite, Vite
- Vue 3, Vue Router, Pinia
- TypeScript, Zod
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

## Current Limitations

- No financial import pipeline
- No SQLite database or migrations
- No transaction model or duplicate detection
- No reconciliation, categorisation, subscriptions, dashboards, or AI analysis
- No signing, notarisation, auto-update, telemetry, or cloud synchronisation

## Documentation

- [Product](docs/PRODUCT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Data model](docs/DATA_MODEL.md)
- [Import rules](docs/IMPORT_RULES.md)
- [Roadmap](docs/ROADMAP.md)
