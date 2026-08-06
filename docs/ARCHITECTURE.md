# Architecture

Current milestone: Phase 4 - Visa Settlement Reconciliation complete.

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

The Electron shell, typed preload API, renderer layout, validation setup, SQLite initialization, migrations, repositories, prepared-import service, EVO/Bankinter Visa XLS importer, EVO/Bankinter account PDF importer, and Visa settlement reconciliation service are implemented. Import UI, dashboards, categorisation, subscriptions, and reconciliation UI remain planned.

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

Import adapters are separate modules from the normalised transaction model. Each adapter parses one source format, validates extracted data, reports confidence and errors, and produces a prepared import for the Phase 1 import service.

The prepared-import service validates input, rejects duplicate committed file hashes for the same account, creates a pending batch, inserts all transactions in one SQLite transaction, and commits the batch atomically. Failed imports leave no partial transactions.

Rollback is a deliberate operation for committed batches. It deletes imported transactions and related transaction links in one transaction, preserves the import-batch record, sets status to `rolled_back`, records `rolled_back_at`, and resets `transaction_count` to zero.

## EVO Visa XLS Importer

The detected EVO/Bankinter Visa export is a legacy Microsoft Excel BIFF workbook in a CFB/OLE2 container. The importer uses `@e965/xlsx` because built-in parsing is not sufficient for BIFF binary workbooks and the package can read the required legacy `.xls` format without the unfixed advisories reported for the older `xlsx` npm package.

The importer remains main-process/application-layer code only. It exposes no renderer file picker, drag-and-drop, arbitrary parser options, or database CRUD IPC.

Importer operations:

- `canHandle` recognises the supported workbook structure.
- `inspect` returns safe counts and structural warnings without writing to the database.
- `prepare` returns a validated `PreparedImport` and performs no duplicate checks or database writes.

The importer enforces a 5 MB maximum before loading workbook buffers. It stores only the basename as `sourceFileName` and calculates file hashes with the streaming SHA-256 utility.

## EVO Account PDF Importer

The detected EVO/Bankinter account statement is a text-based PDF with repeated page and table headers, separate transaction date and value date columns, reference, description, debit, credit, and resulting balance columns. The importer uses `pdfjs-dist` in the Electron main-process/application layer to extract positioned text items. Direct text extraction is sufficient for the supported format because the statement contains a usable text layer with stable coordinates; OCR is not implemented for this adapter.

PDF-specific code is isolated behind the extraction and account-statement parser modules. It is not exposed to the Vue renderer, preload API, IPC, or the Visa importer. PDF.js is configured for local byte parsing without browser UI extraction, OCR, or remote services.

The parser groups positioned text by page and y-coordinate tolerance, orders each visual row by x-coordinate, reconstructs columns from documented x ranges anchored to the detected table header, and removes repeated headers plus the stable footer band. It recognises opening, carried, and final balance rows internally and does not map them to domain transactions.

The importer validates debit/credit signs and resulting balances in integer cents. Debit rows become negative transaction amounts, credit rows become positive transaction amounts, and balance continuity is validated across page boundaries. Blocking structural, parse, or balance warnings prevent preparation; no partial account PDF import is allowed.

Recognised Visa settlement rows are mapped as `card_settlement`, remain visible, keep `excludedFromSpending: false`, and use `reviewStatus: needs_review`. Settlement exclusion and linking remain deferred to reconciliation.

The account PDF importer enforces a 10 MB maximum before parsing, stores only the basename as `sourceFileName`, and calculates file hashes with the streaming SHA-256 utility.

## Visa Settlement Reconciliation

The Phase 4 reconciliation service is main-process/application-layer code. It is not exposed through renderer IPC and does not add a UI.

Reconciliation uses `transaction_links` as the persisted representation. Each included Visa movement gets one directional link:

```text
account settlement transaction -> individual Visa movement
kind = card_settlement
```

The service has three separate operations:

- Candidate discovery is read-only and ranks possible committed Visa batches for one explicit settlement.
- Preview is read-only for one explicit settlement transaction ID and one explicit Visa import-batch ID.
- Commit and reversal are explicit atomic mutations.

Commit requires exact signed integer-cent equality between the settlement amount and the sum of all eligible completed Visa movements from the selected committed Visa batch. Pending Visa movements are counted for preview information but ignored for totals and links. Refunds are positive Visa movements and naturally reduce the signed Visa net amount. There is no tolerance, fuzzy match, subset matching, or automatic reconciliation.

On successful commit, the service creates one `card_settlement` link per included completed Visa movement, sets the settlement `excludedFromSpending: true`, and sets its review status to `confirmed`. Visa movements are not modified. Reversal deletes only the settlement's `card_settlement` links, restores the settlement to `excludedFromSpending: false` and `reviewStatus: needs_review`, and allows later reconciliation again.

Rollback is protected while active card-settlement links involve any transaction in an import batch, either as settlement source or Visa destination. Reconciliation must be reversed before rolling back either side. Historical audit beyond link creation timestamps remains a future enhancement.

## Deterministic Calculations

Financial totals must be calculated from stored integer-cent amounts and ISO dates. Import, reconciliation, categorisation, and reporting code must keep deterministic rules separate from optional suggestions.

## Optional AI Isolation

AI may later help with merchant identification, category suggestions, or explanations. It must be optional, use strict data minimisation, and never generate authoritative financial totals.
