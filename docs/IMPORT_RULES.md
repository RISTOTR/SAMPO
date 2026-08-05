# Import Rules

Current milestone: documentation only. No importer is implemented yet.

## EVO/Bankinter Visa

- Source format: `.xls`
- Contains completed and pending card movements
- Exact internal file format still needs inspection
- Completed and pending versions of the same purchase must not become duplicate expenses

## EVO/Bankinter Account Statement

- Source format: text-based PDF
- Known columns: transaction date, reference, value date, description, debit, credit, balance
- Repeated headers and footers must be ignored
- Previous balance, carried balance and final balance are not transactions
- Balance continuity can help validate extraction
- OCR is not needed for the provided example, but may be a future fallback

## Reconciliation Rule

- Individual Visa purchases count as expenses.
- `RECIBO VISA CLASICA` in the account statement is the card settlement.
- The settlement must remain visible.
- Once matched, the settlement must be excluded from spending totals.
- A settlement difference must be visible and reviewed rather than silently ignored.

## Future Import Requirements

- File hashing
- Duplicate detection
- Import preview
- Validation errors
- Confidence and review states
- Import rollback
- Anonymised test fixtures
- No silent partial import
