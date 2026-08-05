# Architecture

Current milestone: Phase 1 - Financial Core.

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

The Electron shell, typed preload API, renderer layout, validation setup, SQLite initialization, migrations, repositories, and prepared-import service are implemented. XLS/PDF import adapters, dashboards, categorisation, subscriptions, and reconciliation UI remain planned.

## Responsibilities

The Vue renderer owns presentation, route state, and user interaction. It must not access Node.js, SQLite, or the filesystem directly.

The preload script exposes narrow typed APIs through `contextBridge`. It must not expose raw `ipcRenderer`, arbitrary channel names, or Node APIs.

The Electron main process owns privileged operations. It creates the browser window, validates IPC senders, rejects permission requests, blocks uncontrolled navigation and new windows, initializes the local SQLite database, and owns filesystem/database access.

## Security Boundary

The BrowserWindow uses `contextIsolation: true`, `nodeIntegration: false`, renderer sandboxing, and enabled web security. The renderer loads local application content only, with local development server access allowed during development.

Shared IPC channel constants live in `src/shared/ipc.ts`. Shared preload API types live in `src/shared/app-info.ts`.

## Local Storage

Financial storage uses local-only SQLite through `better-sqlite3`, installed as an application dependency and used only by Electron main-process modules.

The production database path is `app.getPath('userData')/sampo.sqlite3`. Tests supply explicit temporary database paths and never open the real user database.

Database initialization enables foreign keys, applies a busy timeout, uses WAL mode for file-backed application databases, runs forward-only migrations, and closes the connection during application shutdown. Initialization failures are surfaced as typed errors; damaged databases are not silently recreated or deleted.

Local database encryption is not implemented in Phase 1 and remains a future decision.

## Migrations

Migrations are explicit, ordered, numeric, and forward-only. Applied migrations are recorded in `schema_migrations`. A fresh database migrates to the latest supported version. Reopening an up-to-date database does not rerun migrations. Databases with an unknown newer schema version fail safely before modification.

## Import Adapter Architecture

Import adapters are planned as separate modules from the normalised transaction model. Each adapter will parse one source format, validate extracted data, report confidence and errors, and produce a prepared import for the Phase 1 import service.

The prepared-import service validates input, rejects duplicate committed file hashes for the same account, creates a pending batch, inserts all transactions in one SQLite transaction, and commits the batch atomically. Failed imports leave no partial transactions.

Rollback is a deliberate operation for committed batches. It deletes imported transactions and related transaction links in one transaction, preserves the import-batch record, sets status to `rolled_back`, records `rolled_back_at`, and resets `transaction_count` to zero.

## Deterministic Calculations

Financial totals must be calculated from stored integer-cent amounts and ISO dates. Import, reconciliation, categorisation, and reporting code must keep deterministic rules separate from optional suggestions.

## Optional AI Isolation

AI may later help with merchant identification, category suggestions, or explanations. It must be optional, use strict data minimisation, and never generate authoritative financial totals.
