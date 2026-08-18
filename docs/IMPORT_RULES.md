# Import Rules

Current milestone: Phase 7 smart AI categorisation complete.

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
- Parsed with `pdfjs-dist` positioned text extraction in the main process/application layer
- Known columns: transaction date, reference, value date, description, debit, credit, balance
- Repeated headers and stable footer content are ignored
- Previous balance, carried balance and final balance are validation markers and are not transactions
- Debit values become negative integer cents; credit values become positive integer cents
- Resulting balances are parsed as integer cents and validated with exact balance continuity
- Balance continuity is validated across page boundaries and against carried/final balances where present
- The observed statement period is derived from the minimum and maximum parsed transaction dates
- OCR, image-only PDFs, encrypted PDFs and unsupported changed layouts are not implemented

## EVO/Bankinter Account Excel

- Source format: `.xlsx` workbook with an account movements table.
- Parsed with `@e965/xlsx` in the main process/application layer.
- Detected by table headers, not filename extension.
- Required headers are `Fecha contable`, `Fecha valor`, `Descripción`, `Importe`, `Saldo`, and `Divisa`.
- Metadata rows before the table are ignored. Metadata date ranges are not used to filter movements.
- Transaction date comes from `Fecha contable`; value date comes from `Fecha valor`.
- Description is preserved as the original transaction description.
- Signed `Importe` values become integer-cent transaction amounts.
- `Saldo` values are stored as `balanceCents`.
- `Divisa` is stored as the transaction currency.
- The observed statement period is derived from the minimum and maximum parsed transaction dates.
- Recognised `RECIBO VISA CLASICA` rows are mapped like account PDF settlements for reconciliation.

## Reconciliation Rule

- Individual Visa purchases count as expenses.
- `RECIBO VISA CLASICA` in the account statement is the card settlement.
- The settlement must remain visible.
- Before matching, the settlement remains visible and is not excluded from spending.
- Once matched by explicit reconciliation commit, the settlement must be excluded from spending totals.
- A settlement difference must be visible and reviewed rather than silently ignored.

## Implemented Import Foundation

- SHA-256 file hashing is implemented as a main-process streaming utility.
- Prepared imports are committed atomically: batch creation, transaction insertion, transaction count, and committed status succeed or fail together.
- A committed file hash cannot be imported twice for the same account.
- A rolled-back file may be deliberately imported again.
- Overlapping exports are filtered at row level with account-scoped stable-fact transaction fingerprints and occurrence counts, so repeated exports do not duplicate already committed rows while genuine repeated identical purchases keep their multiplicity. The overlap fingerprint uses transaction date, normalised original description, signed amount, and currency; it does not use value date, balance, pending/completed state, reference, or import source.
- Rollback removes the imported transactions and related transaction links, preserves the batch record, sets status to `rolled_back`, and resets `transaction_count` to zero.
- Rollback is rejected while any transaction in the import batch participates in active `card_settlement` reconciliation links.
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

## Account PDF Importer Rules

- `canHandle` requires a valid PDF signature, usable text layer, repeated table header, supported account-statement structure and parsed transactions.
- `inspect` reports only safe structural counts and generic warnings; warnings must not include raw descriptions, references, dates, amounts, balances, names or account identifiers.
- `prepare` returns a validated `PreparedImport` and performs no database writes or duplicate checks.
- Preparation fails if any transaction-like row cannot be parsed safely.
- Preparation fails on carried-balance, transaction-balance or final-balance mismatches.
- Unknown non-empty content inside the table region is blocking unless recognised as header, footer or balance-marker structure.
- Date parsing is explicit for European short dates; `Date.parse()` is not used for source dates.
- Money parsing is strict European decimal parsing into integer cents and rejects malformed separators, ambiguous signs and zero movement amounts.
- The importer recognises a Visa settlement description pattern as `card_settlement`, sets `reviewStatus: needs_review`, keeps it visible, and does not exclude it from spending until Phase 4 reconciliation.
- Synthetic tests generate text-based PDFs at runtime with invented data; no generated PDFs are committed.

## Visa Settlement Reconciliation Rules

- Candidate discovery is read-only and never chooses or commits a candidate automatically.
- Preview is read-only and requires an explicit settlement transaction ID and Visa import-batch ID.
- Commit requires the same explicit settlement and Visa batch IDs and runs atomically.
- Link direction is settlement transaction to Visa movement with `kind: card_settlement`.
- Only completed Visa `expense` and `refund` transactions from the selected committed Visa batch are included.
- Pending Visa movements are counted for preview information but ignored for totals and links.
- Settlement amount must exactly equal the signed integer-cent sum of included Visa movements.
- Refunds remain positive and reduce the signed Visa net amount.
- No tolerance, rounding, fuzzy matching, inferred missing transaction, partial batch match, or subset reconciliation is allowed.
- Settlement date must not be earlier than the latest included Visa movement date.
- A Visa movement can be linked to only one active card settlement.
- Commit marks only the settlement as excluded from spending and confirmed; Visa movements remain unchanged.
- Reversal deletes only the settlement's `card_settlement` links, restores the settlement to visible and needs-review, and permits reconciliation again.
- Multiple exact candidates are reported as ambiguous and are not auto-selected.
- Historical reconciliation audit beyond link creation timestamps remains a future enhancement.

## Synthetic Fixture Policy

Visa importer tests generate temporary BIFF `.xls` workbooks from synthetic rows. Account PDF importer tests generate temporary text-based PDFs from synthetic positioned content. No binary workbook or generated PDF fixtures are committed. Synthetic fixtures use invented merchants, descriptions, dates, references and amounts and must never copy genuine statement content.

## Future Import Requirements

- No silent partial import
- Own-account transfer detection
- Subscriptions and dashboards

## Phase 5 UI Import Rules

- File selection uses Electron's native main-process open-file dialog.
- The renderer never provides or receives a full source path.
- Import preview sessions live only in main-process memory and expire after 30 minutes.
- Preview sessions store the prepared import internally and expose only safe DTOs.
- Commit requires explicit user confirmation and revalidates that the file hash has not changed.
- Current accounts can import supported account PDFs and account Excel workbooks.
- Credit-card accounts can import only supported Visa XLS files.
- Cash and other account kinds are not import targets in Phase 5.
- Import history keeps batch records; rollback does not delete history.
- Active card-settlement reconciliation blocks rollback until reversal.

## Phase 6 Categorisation Rules

- Categorisation is enrichment and never overwrites imported transaction facts.
- Active rules are evaluated after a successful import commit for newly inserted transactions.
- A categorisation failure must not roll back or invalidate a valid financial import.
- Pending movements can receive merchant/category enrichment but remain `needs_review`.
- Manual classifications are preserved by default during rule evaluation and historical application.
- Import rollback deletes transactions and cascades their transaction classification rows. Categories, merchants, aliases and rules remain.
- Reconciliation links and settlement exclusion flags are independent from categorisation.
- Broad description rules do not automatically categorise card settlements or transfers; exact or merchant-targeted rules are required.
- Merchant alias matching is deterministic, case-insensitive, whitespace-normalised, and limited to exact, starts-with and contains matching.
- Regular expressions and hidden automatic rules are not implemented.

## Phase 7 AI Categorisation Rules

- AI categorisation is optional and disabled by default.
- AI requests are created in the main process only.
- Bulk classification sends normalised descriptors and category context, not amounts, balances, account identifiers, source files, source paths, or statement contents.
- Web lookup is disabled unless the user explicitly enables it.
- AI suggestions are pending review records and do not change imported transaction facts.
- Existing confirmed classifications remain authoritative until the user explicitly accepts a differing AI field.
- Accepting an AI suggestion is explicit and stores user-reviewed enrichment with source `ai`.
- AI suggestion acceptance is field-aware: accepting only merchant or only category confirms that field and leaves any other differing suggested field pending until reviewed. Suggestions that already match the current classification do not produce actionable review cards.
- AI failures must not roll back or invalidate a valid financial import.
