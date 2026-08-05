# Architecture

Current milestone: Phase 0 foundation.

```text
Vue renderer
    -> typed preload API
Electron preload
    -> validated IPC
Electron main process
    ->
Application services
    ->
Import adapters / repositories / SQLite
```

Only the Electron shell, typed preload API, renderer layout, and validation setup are implemented now. Application services, import adapters, repositories, and SQLite are planned.

## Responsibilities

The Vue renderer owns presentation, route state, and user interaction. It must not access Node.js, SQLite, or the filesystem directly.

The preload script exposes narrow typed APIs through `contextBridge`. It must not expose raw `ipcRenderer`, arbitrary channel names, or Node APIs.

The Electron main process owns privileged operations. It creates the browser window, validates IPC senders, rejects permission requests, blocks uncontrolled navigation and new windows, and will later own filesystem and database access.

## Security Boundary

The BrowserWindow uses `contextIsolation: true`, `nodeIntegration: false`, renderer sandboxing, and enabled web security. The renderer loads local application content only, with local development server access allowed during development.

Shared IPC channel constants live in `src/shared/ipc.ts`. Shared preload API types live in `src/shared/app-info.ts`.

## Local Storage

Financial storage is planned as local-only SQLite. SQLite is intentionally not installed or implemented in Phase 0.

When introduced, database access belongs in the Electron main process behind application services and repositories. The renderer will request data through narrow preload APIs.

## Import Adapter Architecture

Import adapters are planned as separate modules from the normalised transaction model. Each adapter will parse one source format, validate extracted data, report confidence and errors, and produce normalised candidate transactions for review.

## Deterministic Calculations

Financial totals must be calculated from stored integer-cent amounts and ISO dates. Import, reconciliation, categorisation, and reporting code must keep deterministic rules separate from optional suggestions.

## Optional AI Isolation

AI may later help with merchant identification, category suggestions, or explanations. It must be optional, use strict data minimisation, and never generate authoritative financial totals.
