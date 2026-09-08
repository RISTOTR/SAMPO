# Visa XLS import rejection report

Inspected on 2026-09-08. Scope: diagnose the supplied `movimientos (6).xls`; no importer changes or database writes.

## Resolution

The importer now accepts completed-only exports. Detection and preparation both treat the pending section as optional while requiring its column header when present. Synthetic importer and preview/commit regression tests cover the change. Post-fix read-only verification of the supplied file passed detection and preparation with 50 completed transactions, zero pending transactions, and zero warnings. All 202 tests across 19 test files passed; type checking, lint, formatting, and the production build passed. The Electron UI was not manually exercised. The findings below document the original failure before this fix.

## Finding

The supplied file is readable and contains completed movements that the Visa importer can parse. It is rejected because the importer requires a pending-movements section and its column header even when the export contains only completed movements.

Local inspection found:

- Valid CFB/OLE2 legacy Excel workbook, 8,704 bytes, below the 5 MiB limit.
- One worksheet, 57 rows, with the supported movement header on row 5.
- 50 successfully parsed completed movements and zero parsed pending movements.
- No recognised `MOVIMIENTOS PENDIENTES` section.
- Exactly one blocking inspection warning: `missing_section`, “Pending movements section was not found.”

No transaction descriptions, dates, amounts, account identifiers, or raw worksheet rows are reproduced here. The source file was read locally and was not copied into the repository or sent to an external service.

## Why the interface shows this error

1. `EvoVisaXlsImporter.canHandle` requires `completedHeaderFound`, `pendingSectionFound`, and `pendingHeaderFound` together (`src/main/importers/evo-visa/evo-visa-xls-importer.ts:45`). The supplied file therefore returns `false` despite having a readable, supported completed-movement table.
2. `ImportPreviewWorkflow.detectImporter` throws `UnsupportedImportFormatError` when no adapter accepts the file (`src/main/workflows/import-preview-workflow.ts:175`). Detection happens before account compatibility checks and before the normal inspection/preview step.
3. The workflow error mapper translates that exception into “The selected file is not supported.” (`src/main/workflows/errors.ts:66`). The more specific missing-section warning never reaches the normal preview.
4. Bypassing detection alone would not fix import: `missingStructureWarnings` also makes the absent pending section blocking, and direct `prepare` throws `ImportParseError` (`src/main/importers/evo-visa/evo-visa-xls-importer.ts:321`).

This failure occurs before duplicate checking or import commit. Renaming the extension will not resolve the structural requirement.

## Why it appears now

The available Git history for the Visa importer shows its original introduction in commit `0108b1e` (`feat: add evo visa xls importer`), with no later commits for this file. The evidence points to an existing layout restriction exposed by this export, rather than an established recent change to this importer.

No earlier successful export or running application build was compared. Whether the bank changed its export layout or simply omits the pending section under some conditions remains unverified. An absent section alone does not establish the actual pending balance or whether pending movements exist at the bank.

## Verification

- Commands: `file` on the supplied workbook; `rg`, `cat`, and `nl` to inspect importer, workflow, errors, tests, and documentation; `git status --short` and `git log` for repository state/history.
- Read-only Node diagnostic using the installed TypeScript transpiler and XLSX library: actual importer `canHandle` returned `false`; `inspect` parsed 50 completed movements and reported only the missing pending section; `prepare` threw `ImportParseError`. No persistence APIs were called.
- Two temporary, wholly synthetic BIFF workbooks tested the distinction: completed-only export was rejected; the same synthetic movement with an empty pending section and its header was accepted and prepared successfully. Both assertion cases passed. Temporary fixtures were removed.
- Manual verification: reviewed the structural diagnostic and traced the error path in source. The Electron interface was not exercised.
- Full application tests, build, lint, and type checking were not run for this report-only change. No production code changed.

## Recommended next step and remaining risks

Update detection and preparation consistently to support completed-only Visa exports, while requiring a valid pending header when a pending section is present. Retain strict rejection of malformed movement rows and unknown content; do not manufacture an empty pending section in the original financial file.

Add synthetic regression coverage for completed-only exports, empty pending sections, populated pending sections, malformed pending headers, and the preview workflow. Existing successful Visa fixtures include a pending section and do not cover the completed-only case.

The recommendation requires implementation and validation. This report does not change import behavior or prove compatibility with other export layouts or the installed application build.

Files changed: only `docs/VISA_XLS_IMPORT_DIAGNOSIS.md`.
