# Product

Sampo is a local-first macOS desktop application for analysing personal finances from exported bank files. The initial target user is one personal user who wants reliable insight into card and account spending while keeping financial records local by default.

## Core Problem

Bank exports are fragmented: Visa purchases, pending movements, card settlements, transfers, and account statements do not naturally form one clean spending view. Sampo will import these local files, normalise transactions, reconcile settlements, and produce deterministic summaries.

## Input Sources

- EVO/Bankinter Visa movements exported as `.xls`
- EVO/Bankinter account movements exported as text-based PDF or account Excel workbook

## Expected Value

- Clear monthly spending and income summaries
- Duplicate-resistant imports
- Visible reconciliation between card purchases and card settlement payments
- Deterministic merchant and category enrichment for imported transactions
- Optional AI merchant and category suggestions for explicit review
- Better location, date, and weekday analysis later
- Optional explanations later, without treating AI as authoritative

## Privacy Principles

- Financial data is local only.
- No telemetry, analytics, cloud sync, or automatic upload.
- Real financial files must never be committed.
- AI features must be optional, minimise data exposure, and never be authoritative financial data.

## V1 Scope

- Secure Electron/Vue application shell
- Local import and normalisation pipeline
- SQLite persistence in the Electron main process
- Deterministic reporting and reconciliation
- Manual review of uncertain import and reconciliation results
- Optional descriptor-only AI categorisation suggestions

## Explicit Exclusions From V1

- Direct bank connections
- Open Banking
- Multiple users
- Mobile apps
- Cloud synchronisation
- Automatic updates
- Mac App Store distribution
- Multiple banks
- AI-generated financial calculations

## Future Possibilities

- Natural-language questions over local summaries
- Signing and notarisation
- External-user testing
