# Sampo Development Instructions

## Product Principles

- Sampo is local-first and privacy-sensitive.
- Never send financial data to external services unless a later feature explicitly requires it.
- Never silently add telemetry, analytics or cloud synchronisation.
- Financial totals must always be deterministic.
- AI output must never be treated as authoritative financial data.
- Do not log names, IBANs, account numbers, full transaction descriptions or statement contents.
- Never commit genuine financial files.

## Engineering Rules

- TypeScript strict mode is mandatory.
- Validate all external data at system boundaries with Zod.
- Monetary values will be stored as integer cents.
- Dates will be stored as ISO `YYYY-MM-DD`.
- Database and filesystem access belong in the Electron main process.
- The Vue renderer must never access SQLite, Node.js or the filesystem directly.
- Expose only narrow, typed preload APIs.
- Tests that exercise persistence must use explicit temporary database paths.
- Never open or modify the real user database from automated tests.
- Import adapters must remain separate from the normalised transaction model.
- Avoid large components and unrelated refactoring.
- Do not add dependencies without a clear reason.
- Preserve user data compatibility once persistence is introduced.

## Task Workflow

Before implementing a substantial feature:

1. Read the relevant documentation.
2. Inspect existing architecture.
3. Present or internally establish a bounded implementation plan.
4. Implement only the requested scope.
5. Add or update tests.
6. Run all validation commands.
7. Update documentation when behaviour or architecture changes.

## Completion Report

Every completed Codex task must report:

- Summary
- Files changed
- Commands run
- Test results
- Manual verification performed
- Remaining risks
- Suggested next step
