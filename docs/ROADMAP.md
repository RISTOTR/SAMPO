# Roadmap

Current milestone: Phase 1 - Financial Core complete.

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

- Inspect `.xls` internals
- Parse completed movements
- Parse pending movements
- Normalise dates and amounts
- Duplicate handling
- Anonymised fixtures and tests

## Phase 3 - Account PDF Importer

- PDF.js text extraction
- Coordinate-based row reconstruction
- Multi-page statements
- Header and footer removal
- Debit and credit detection
- Balance validation
- Anonymised fixtures and tests

## Phase 4 - Reconciliation

- Visa settlement detection
- Settlement matching
- Own-account transfer detection
- Refund linking
- Reconciliation review UI

## Phase 5 - Categorisation

- Categories
- Merchant normalisation
- Manual corrections
- Reusable rules
- Business/personal classification

## Phase 6 - Subscriptions and Analysis

- Recurring-series detection
- Subscription review
- Monthly comparisons
- Weekday analysis
- Merchant and location analysis

## Phase 7 - Optional AI

- Unknown merchant research
- Category suggestions
- Monthly explanations
- Natural-language questions
- Strict data minimisation

## Phase 8 - Distribution

- Signing
- Notarisation
- Backups
- External-user testing
- Optional auto-update
