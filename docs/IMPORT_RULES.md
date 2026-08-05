# Import Rules

Current milestone: Phase 2 EVO/Bankinter Visa XLS importer. The account PDF parser is not implemented yet.

## EVO/Bankinter Visa

- Source format: `.xls`
- Contains completed and pending card movements
- Detected internal format: legacy Microsoft Excel BIFF workbook in a CFB/OLE2 container
- Parsed with `@e965/xlsx`
- Uses a three-column movement table: transaction date, merchant/ATM description, amount
- Dates are Excel serial dates
- Amounts are numeric values; normal purchases are negative and refunds are positive
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

## Visa XLS Importer Rules

- Completed movements and pending movements are parsed as separate sections.
- Pending movements are imported as transaction candidates with `isPending: true` and `reviewStatus: needs_review`.
- Preparation fails if any transaction-like row cannot be safely converted.
- Decorative rows, section labels, headers, totals, and blank rows are recognised and are not imported as transactions.
- Unknown non-empty rows inside a movement section become blocking warnings.
- Inspection reports only safe structural counts and generic warning codes.
- Warnings must not include raw rows or merchant descriptions.
- A candidate key helper exists for future pending/completed comparison using date, normalised description, absolute amount, and currency. It is not a permanent identity and does not delete or merge transactions.
- Candidate-key limitations: posting dates can change, merchant text can change, exchange-rate amounts can change, and multiple purchases can legitimately share the same date, description, and amount.

## Synthetic Fixture Policy

Visa importer tests generate temporary BIFF `.xls` workbooks from synthetic rows. No binary workbook fixtures are committed. Synthetic fixtures use invented merchants, dates, and amounts and must never copy genuine statement content.

## Future Import Requirements

- Import preview
- Validation errors
- Confidence and review states
- Anonymised test fixtures
- No silent partial import
