# Roadmap

Current milestone: Phase 8 - Recurring Payments and Subscriptions in progress.

## Phase 0 - Foundation

- Secure Electron/Vue shell
- Documentation
- Testing and quality commands
- Basic macOS package

## Phase 1 - Financial Core

- Domain model - complete
- SQLite - complete
- Migrations - complete
- Import batches - complete
- File hashing - complete
- Rollback - complete
- Transaction repository - complete

## Phase 2 - Visa Importer

- Inspect `.xls` internals - complete
- Parse completed movements - complete
- Parse pending movements - complete
- Normalise dates and amounts - complete
- Duplicate handling through Phase 1 prepared-import service - complete
- Anonymised generated fixtures and tests - complete

## Phase 3 - Account PDF Importer

- PDF.js text extraction - complete
- Coordinate-based row reconstruction - complete
- Multi-page statements - complete
- Header and footer removal - complete
- Debit and credit detection - complete
- Balance validation - complete
- Anonymised generated fixtures and tests - complete
- Privacy-safe ignored real-file smoke validation - complete

## Phase 4 - Reconciliation

- Visa settlement matching - complete
- Candidate discovery and preview - complete
- Atomic commit and reversal - complete
- Import rollback protection during active reconciliation - complete
- Privacy-safe ignored real-file smoke validation - complete
- Own-account transfer detection
- Refund linking beyond Visa-settlement batch matching
- Reconciliation review UI

## Phase 5 - End-to-End Workflow UI

- Account management UI - complete
- Native file selection and import preview sessions - complete
- Explicit all-or-nothing import commit - complete
- Import history and rollback controls - complete
- Paginated transaction list with filters - complete
- Reconciliation review, commit and reversal UI - complete
- Privacy-safe real-file workflow validation - complete

## Phase 6 - Categorisation

- Categories and subcategories - complete
- Canonical merchants and aliases - complete
- Manual transaction classification - complete
- Reusable deterministic rules - complete
- Historical rule preview and application - complete
- Business/personal, fixed/variable and essential/discretionary classification - complete
- Transaction filters by classification data - complete

## Phase 7 - Smart AI Categorisation

- Optional local settings and API-key storage - complete
- Descriptor-only OpenAI classification provider with response storage disabled - complete
- Pending AI suggestions separate from imported transaction facts - complete
- Explicit suggestion accept/reject workflow - complete
- Optional web lookup setting - complete
- Post-import AI classification when enabled - complete

## Phase 8 - Subscriptions and Analysis

- Deterministic recurring-series detection - complete
- Subscription, recurring bill, recurring payment review - complete
- Candidate rejection persistence - complete
- Recurring series detail with linked transactions - complete
- Monthly comparisons
- Weekday analysis
- Merchant and location analysis

## Phase 9 - AI Analysis Extensions

- Monthly explanations
- Natural-language questions
- Strict data minimisation for any expanded AI use

## Phase 10 - Distribution

- Signing
- Notarisation
- Backups
- External-user testing
- Optional auto-update
