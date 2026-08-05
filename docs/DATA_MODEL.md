# Data Model

Current milestone: preliminary planning only. No final database schema exists yet.

## Locked Conventions

- Incoming money is positive.
- Outgoing money is negative.
- Money is stored as integer cents.
- Dates use ISO `YYYY-MM-DD`.
- Every imported transaction belongs to an import batch.
- Card settlements remain visible but are excluded from spending after reconciliation.
- Own-account transfers remain visible but are excluded from income and spending.
- Pending Visa movements are not included in final monthly totals.

## Planned Entities

`Account` represents a local financial account or card source.

`ImportBatch` records one attempted file import, including source type, file hash, validation status, and rollback metadata.

`Transaction` represents a normalised movement with date, amount in cents, description, account, import batch, and review state.

`Merchant` represents a canonical merchant identity.

`MerchantAlias` maps raw descriptions or detected names to a merchant.

`Category` represents user-controlled spending or income categories.

`CategorisationRule` stores deterministic user rules for applying categories.

`RecurringSeries` represents subscriptions or recurring payment candidates.

`TransactionLink` represents relationships such as Visa purchase to settlement, refund to purchase, or own-account transfer pairs.

`MonthlyReport` represents reproducible monthly summary outputs derived from stored transactions and rules.

Fields and relationships are preliminary and will be refined when SQLite and migrations are introduced.
