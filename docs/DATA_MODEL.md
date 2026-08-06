# Data Model

Current milestone: Phase 4 Visa settlement reconciliation over the Phase 1 schema foundation. The database schema may still evolve through forward-only migrations before external-user use.

## Locked Conventions

- Incoming money is positive.
- Outgoing money is negative.
- Money is stored as integer cents.
- Dates use ISO `YYYY-MM-DD`.
- Timestamps use UTC ISO date-time strings.
- The default currency is `EUR`.
- Every imported transaction belongs to an import batch.
- Every imported transaction belongs to an account.
- Card settlements remain visible and are excluded from spending only after reconciliation.
- Own-account transfers remain visible but are excluded from income and spending.
- Pending Visa movements are not included in final monthly totals.
- Financial totals must never use floating-point values.
- Phase 1 rejects zero-value transactions. Source-specific importers may later add explicit handling if a real source requires them.

## Implemented Tables

`accounts` stores local account metadata: `id`, `name`, `kind`, optional `institution`, `currency`, and timestamps. It does not store IBANs, full card numbers, or credentials.

`import_batches` records one prepared import attempt, including account, source kind, source filename only, SHA-256 hash, optional statement period, status, transaction count, and lifecycle timestamps.

`transactions` stores normalised imported movements with account, import batch, source row index, dates, optional reference, required original description, optional normalised merchant, integer-cent amount, optional balance, currency, transaction type, pending flag, spending exclusion flag, review status, and timestamps.

`transaction_links` stores directional links between transactions for future reconciliation. Links can represent card settlements, own-account transfers, refunds, or related transactions. Link creation does not change amounts.

`schema_migrations` records applied forward-only database migrations.

## Planned Entities

The following planned entities are not implemented in Phase 1:

- `Merchant`
- `MerchantAlias`
- `Category`
- `CategorisationRule`
- `RecurringSeries`
- `MonthlyReport`

`TransactionLink` stores Phase 4 Visa settlement reconciliation links. Historical reconciliation audit beyond link creation timestamps remains planned.

Fields and relationships remain subject to forward-only migrations once importer evidence is available.

## Visa Import Mapping

The EVO/Bankinter Visa importer maps workbook movements to `NewTransaction` objects:

- Completed movements use `isPending: false`.
- Pending movements use `isPending: true` and `reviewStatus: needs_review`.
- The workbook uses Excel serial dates, converted explicitly to ISO `YYYY-MM-DD`.
- Numeric Visa purchase amounts are already negative in the source and remain negative integer cents.
- Positive Visa amounts are treated as refunds and mapped to `transactionType: refund`.
- Currency defaults to `EUR` for the supported export.
- `sourceRowIndex` is the zero-based physical worksheet row index, which is deterministic and unique within a statement.

The importer does not create categories, merchants, subscriptions, reconciliation results, or permanent duplicate identities.

## Account PDF Import Mapping

The EVO/Bankinter account PDF importer maps validated statement movements to `NewTransaction` objects:

- Debit column values become negative integer-cent amounts.
- Credit column values become positive integer-cent amounts.
- Resulting account balances are stored as `balanceCents`.
- Transaction date and value date are parsed explicitly from short European dates and stored as ISO `YYYY-MM-DD`.
- References are stored when present.
- Currency defaults to `EUR` for the supported statement layout.
- `sourceRowIndex` is a deterministic zero-based transaction-row index after structural rows are excluded.
- Opening, carried, and final balance rows are validation markers only and are not persisted as transactions.
- Normal negative movements are `expense`; normal positive movements are `income`.
- Structurally recognised Visa settlement rows are `card_settlement`, `reviewStatus: needs_review`, and remain `excludedFromSpending: false` until Phase 4 reconciliation links them to Visa movements.

The importer does not detect own-account transfers, refunds, categories, merchants, subscriptions, or reconciliation links.

## Visa Settlement Reconciliation Mapping

Phase 4 reconciles one account `card_settlement` transaction to one committed EVO Visa import batch. The persisted link direction is:

```text
from_transaction_id = account settlement transaction
to_transaction_id   = individual Visa transaction
kind                = card_settlement
```

Only completed Visa `expense` and `refund` transactions from the selected batch are eligible. Pending Visa transactions are ignored for matching and are not linked. The selected Visa batch is matched as a whole; partial settlement matching is not implemented.

The settlement amount must exactly equal the signed integer-cent sum of eligible Visa transactions. Refunds are positive and reduce the net Visa charge. No tolerance, rounding, or fuzzy matching is allowed.

After commit, the settlement is excluded from spending and marked confirmed. Visa transactions remain unchanged. Reversal removes only the settlement's `card_settlement` links and restores the settlement to visible, needs-review state.
