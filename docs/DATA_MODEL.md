# Data Model

Current milestone: Phase 7 smart AI categorisation over the Phase 1-6 import, reconciliation, and deterministic categorisation foundation. The database schema may still evolve through forward-only migrations before external-user use.

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

`categories` stores a two-level category tree. Default system categories are seeded with stable IDs. User categories can be added, deactivated, reactivated, and deleted only while unused.

`merchants` stores canonical merchant names. `merchant_aliases` stores deterministic case-insensitive description matching patterns for `exact`, `starts_with`, and `contains` matches. Aliases preserve the user-entered pattern and store a normalised pattern only for matching.

`categorisation_rules` stores user-approved deterministic rules based on either a canonical merchant or a supported description match. Rules may assign category, usage type, cost behaviour, necessity, and merchant-related enrichment.

`transaction_classifications` stores one classification record per transaction. It is separate from imported transaction facts and is deleted by foreign-key cascade when an import rollback deletes its transactions.

`ai_settings` stores local AI feature flags and optional location context. It does not store the OpenAI API key.

`ai_classification_suggestions` stores pending, accepted, rejected, superseded, or failed AI suggestions. Suggestions reference transactions and optional categories, keep provider/model/confidence metadata, and remain separate from accepted classification enrichment.

`ai_suggestion_sources` stores HTTPS sources attached to web-derived AI suggestions.

`schema_migrations` records applied forward-only database migrations.

## Planned Entities

The following planned entities are not implemented:

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

## Renderer DTOs

Phase 5 exposes explicit DTOs for account summaries, import previews, import batches, transaction pages, reconciliation candidates, reconciliation previews, and safe operation errors. DTOs use camelCase and do not expose SQL row names, database paths, full source paths, file hashes, importer objects, or native library objects.

Import preview sessions are not stored in SQLite. They exist only in main-process memory and are referenced by an opaque UUID until commit, discard, expiry, or shutdown.

## Classification Enrichment

Imported source facts remain immutable for categorisation purposes: dates, descriptions, amounts, balances, transaction type, pending state, import batch, and reconciliation links are not overwritten by Phase 6.

Classification enrichment is stored separately in `transaction_classifications`:

- `merchant_id`
- `category_id`
- `usage_type`: `personal`, `business`, `mixed`, or `unspecified`
- `cost_behaviour`: `fixed`, `variable`, or `unspecified`
- `necessity`: `essential`, `discretionary`, or `unspecified`
- `classification_source`: `manual`, `rule`, `ai`, or `unclassified`
- `classification_status`: `confirmed`, `needs_review`, or `ambiguous`
- optional `applied_rule_id`

Manual classifications are authoritative. Rule application fills unclassified or rule-generated values and preserves manual rows by default.

## AI Suggestion Enrichment

AI suggestions are not imported transaction facts. They are review records with confidence metadata and do not affect reports until explicitly accepted. Accepting a suggestion may create classification enrichment with source `ai` and may create or reuse a canonical merchant when the user accepts the merchant suggestion. Merchant aliases remain explicit deterministic enrichment and are not created as a side effect of AI suggestion acceptance. Manual classifications remain authoritative and are not silently overwritten by AI acceptance.
