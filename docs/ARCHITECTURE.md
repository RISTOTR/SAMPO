# Architecture

Current milestone: Phase 7 - Smart AI Categorisation complete.

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

The Electron shell, typed preload API, renderer layout, validation setup, SQLite initialization, migrations, repositories, prepared-import service, EVO/Bankinter Visa XLS importer, EVO/Bankinter account PDF importer, EVO/Bankinter account Excel importer, Visa settlement reconciliation service, account/import/transaction/reconciliation UI, deterministic transaction categorisation, and optional AI categorisation suggestions are implemented. Subscriptions, recurring-series detection, charts, monthly analysis, and broader AI analysis remain planned.

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

Development can override the database path with `SAMPO_DATABASE_PATH` for disposable manual workflow testing. This is a main-process environment override only; the renderer cannot choose database paths. Production builds continue to use `app.getPath('userData')/sampo.sqlite3`.

Database initialization enables foreign keys, applies a busy timeout, uses WAL mode for file-backed application databases, runs forward-only migrations, and closes the connection during application shutdown. Initialization failures are surfaced as typed errors; damaged databases are not silently recreated or deleted.

Local database encryption is not implemented in Phase 1 and remains a future decision.

## Migrations

Migrations are explicit, ordered, numeric, and forward-only. Applied migrations are recorded in `schema_migrations`. A fresh database migrates to the latest supported version. Reopening an up-to-date database does not rerun migrations. Databases with an unknown newer schema version fail safely before modification.

## Import Adapter Architecture

Import adapters are separate modules from the normalised transaction model. Each adapter parses one source format, validates extracted data, reports confidence and errors, and produces a prepared import for the Phase 1 import service.

The prepared-import service validates input, rejects duplicate committed file hashes for the same account, filters overlapping rows by account-scoped stable-fact fingerprint occurrence counts, creates a pending batch, inserts all new transactions in one SQLite transaction, and commits the batch atomically. Failed imports leave no partial transactions.

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

## EVO Account Excel Importer

The detected EVO/Bankinter account workbook is an Excel file with metadata rows above a movement table. The importer uses `@e965/xlsx` and recognises the source by required Spanish table headers rather than filename extension.

The parser scans workbook sheets for `Fecha contable`, `Fecha valor`, `Descripción`, `Importe`, `Saldo`, and `Divisa`, then parses only rows below the detected table header. Metadata rows and blank rows are ignored. Metadata date ranges are not authoritative and do not filter parsed rows.

The importer maps signed movement amounts, value dates, resulting balances, currencies, and original descriptions into the same normalised current-account transaction model used by the account PDF importer. Recognised Visa settlement rows become `card_settlement`, remain visible, and keep `reviewStatus: needs_review` until explicit reconciliation.

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

## Phase 5 Workflow UI

The first usable workflow is exposed through narrow grouped preload APIs under `window.sampo.accounts`, `window.sampo.imports`, `window.sampo.transactions`, `window.sampo.reconciliation`, and `window.sampo.overview`. The preload does not expose raw `ipcRenderer`, arbitrary channels, SQL, file paths, database paths, importer instances, or native objects.

Renderer requests are validated in the main process with Zod-backed DTO schemas. Responses use explicit camelCase DTOs rather than storage rows. Main-process errors are mapped to stable renderer-safe error codes without stack traces, SQL, native errors, or full file paths.

Native file selection happens only in the main process with Electron's open-file dialog. Import preview sessions are stored only in main-process memory, use unpredictable UUIDs, expire after 30 minutes, store full source paths internally only, and are removed after commit, discard, expiry, or shutdown. The renderer receives only source filenames, inspection summaries, and prepared transaction previews.

Supported Phase 5 account/source combinations are:

```text
current account     -> EVO account PDF or account Excel
credit-card account -> EVO Visa XLS
```

Imports remain all-or-nothing. Preview and inspection do not write to SQLite. Commit revalidates source compatibility and file hash, then uses the existing atomic prepared-import service. Import history supports rollback for unreconciled committed batches and communicates active reconciliation blocking.

The transaction list uses focused repository filtering and pagination with a default page size of 50. Text search is executed in the main-process query against original transaction descriptions and resolved merchant names, and combines with date, category, type, confirmation-state, and pagination filters. The reconciliation review workflow lists card settlements, displays candidate Visa batches, requires explicit preview and confirmation, and supports explicit reversal.

## Phase 6 Categorisation

Categorisation is main-process/application-layer code. Imported transaction facts remain in `transactions`; user-managed enrichment lives in separate classification tables. Renderer APIs are grouped under `window.sampo.categories`, `window.sampo.merchants`, `window.sampo.merchantAliases`, `window.sampo.classification`, and `window.sampo.rules`.

Categories are a two-level tree with seeded default system categories. Merchants are canonical user records. Merchant aliases use deterministic case-insensitive matching with normalised whitespace and supported match kinds: exact, starts-with, and contains. User-provided regular expressions and AI merchant lookup are not implemented.

Rule evaluation is deterministic and read-only until an explicit apply operation. Alias ranking is exact over starts-with over contains, then higher priority. Rule ranking prefers merchant rules over exact description rules, then starts-with, then contains, with priority applied inside each rank. Equal-rank conflicting outputs become `ambiguous` and require review.

Manual classifications are authoritative. Automatic and historical rule application preserve manual rows by default and never changes imported amounts, dates, descriptions, reconciliation links, or import-batch history. After a successful import commit, active rules are evaluated synchronously for the newly inserted transactions; categorisation failures are swallowed so a valid financial import remains committed.

Reconciliation remains independent. Broad description rules do not automatically assign ordinary categories to card settlements or transfers; exact or merchant-targeted rules are required. Reversing reconciliation does not erase classification.

## Deterministic Calculations

Financial totals must be calculated from stored integer-cent amounts and ISO dates. Import, reconciliation, categorisation, and reporting code must keep deterministic rules separate from optional suggestions.

## Phase 7 Smart AI Categorisation

AI categorisation is main-process/application-layer code. Renderer APIs are grouped under `window.sampo.ai`; the preload does not expose raw OpenAI clients, arbitrary provider prompts, API-key readback, file paths, SQL, or a generic URL opener.

The OpenAI API key is stored locally through Electron `safeStorage` in the user-data directory. The renderer can save, delete, and test the key, but it never receives the stored key value.

Provider requests use the OpenAI Responses API with structured JSON output and `store: false`. The bulk classifier sends normalised descriptors, source context, enabled category choices, and optional country/city context. It does not send amounts, balances, account identifiers, transaction dates, source filenames, source paths, statement contents, or database rows. Web search is not attached unless the user enables web lookup.

AI suggestions are persisted separately in `ai_classification_suggestions` and remain pending until explicitly accepted, rejected, or superseded. Pending suggestions do not override current confirmed classifications; the review UI shows only unresolved fields or AI fields that differ from the authoritative transaction state. Accepting a suggestion writes user-reviewed classification enrichment with source `ai`; it can replace a differing merchant or category only through explicit user action and never modifies imported transaction facts, reconciliation links, amounts, dates, descriptions, or import-batch history. Merchant and category acceptance are tracked by the authoritative transaction classification fields: a two-field suggestion remains pending when only one differing suggested field has been accepted. AI output is suggestion data only and must never generate authoritative financial totals.
