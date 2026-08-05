# Import Rules

Current milestone: Phase 1 persistence and prepared-import foundation. No XLS or PDF parser is implemented yet.

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

## Implemented Import Foundation

- SHA-256 file hashing is implemented as a main-process streaming utility.
- Prepared imports are committed atomically: batch creation, transaction insertion, transaction count, and committed status succeed or fail together.
- A committed file hash cannot be imported twice for the same account.
- A rolled-back file may be deliberately imported again.
- Rollback removes the imported transactions and related transaction links, preserves the batch record, sets status to `rolled_back`, and resets `transaction_count` to zero.
- Source adapters must store only source filenames, never full source paths.

## Future Import Requirements

- Import preview
- Validation errors
- Confidence and review states
- Anonymised test fixtures
- No silent partial import
