# Dashboard audit — 2026-10-06

The initial presentation redesign paused under the requested accounting-first stop rule.
After the user instructed development to continue, the two reproduced blockers were
fixed before presentation work resumed. The spending formula is unchanged.
All reproduction data is synthetic and uses explicit temporary database paths.

## Financial blockers resolved

1. `DashboardAnalyticsService.dataQuality` joins classifications regardless of
   confirmation status and treats any category ID as classified. Category analysis
   correctly joins only confirmed classifications. A €100 expense with a
   `needs_review` rule classification therefore appears as €100 Unclassified in
   categories, but €0 unclassified and 100% classified in data quality.
2. Category and classification percentage DTOs constrain values to 0–100. Refunds
   can legitimately produce signed shares outside this interval: a €100 classified
   purchase and €20 unclassified refund produce €80 net spending, category shares
   of 125% and −25%, and classified coverage of 125%. The application workflow
   parses the complete response with this DTO, so valid financial data can prevent
   the Dashboard from loading. Do not clamp financial amounts to hide this issue.

Both reproduction cases now pass as ordinary regression tests. They also assert
the exact integer-cent category-sum invariant. The service now enforces that
invariant before returning any Dashboard data. Percentage DTOs accept signed
shares; the UI labels these as shares of net spending.

## Initial findings from source inspection

- The Unclassified drill-down requires missing classification rows or
  `classification_source = 'unclassified'` in Transactions. It does not include all
  unconfirmed category assignments that Dashboard groups as Unclassified.
- Periods compare full calendar ranges; latest imported month is retained, but the
  selected dates and partial-data caveat are not displayed. Date fields appear even
  for presets that ignore them. There is no comparable month-to-date calculation.
- Biggest changes derives only from current category rows, missing a category
  whose spending falls to zero with no current transactions.
- Monthly trend omits months without transactions. Its graphic displays only
  spending; zero and negative amounts get a misleading minimum positive width.
- Recurring totals use confirmed series. The recurring comparison DTO compares
  against a hard-coded zero; the current view wisely does not display that delta.
  The monthly baseline and series count are global, while observed recurring spend
  is period-specific; this scope distinction needs clearer labels.
- Data quality lacks an unreconciled settlement count/action. Imports already
  contains reconciliation review. Needs-confirmation is the only current action
  for the whole quality card, including its unclassified amount.
- Net cash flow has a supplied comparison that the current view does not display.
- Category rows are sorted by the service, but all rows render without expansion.
  Merchants are limited to ten and use canonical merchant filters or description
  search. Search fallback is not an exact membership filter.
- The existing shell supports collapsed navigation and main-only scrolling. Global
  dark/light surface, border, accent, and warm review tokens are reusable. No chart
  dependency is installed.

## Implementation and remaining scope

The classification join and percentage DTO issues are fixed. Transactions'
Unclassified filter now includes missing categories and unconfirmed assignments.
Biggest changes includes categories present only in the comparison period.
Period metadata exposes the latest included transaction date and comparison
transaction count; data quality adds an unreconciled settlement count.

The presentation uses four compact metric cards, a prominent actionable review
strip, grouped monthly income/spending SVG bars, expandable CSS category bars,
ranked merchants, changes, and a recurring breakdown. No chart dependency was
added. Missing months are marked as no imported activity, not inferred coverage.
Monthly values remain available in an accessible disclosure and keyboard actions.
Zero and negative chart values retain their meaning.

Full calendar comparisons remain unchanged and are explicitly labelled. Comparable
month-to-date semantics remain deferred. Recurring comparisons against the previous
period remain hidden because the service's existing comparison uses zero rather
than actual historical recurring spend. The baseline is labelled approximate and
global. Own-account transfer detection remains deferred.

Category/merchant drill-downs remain contextual Transactions filters rather than
an exact spending-only ledger: other transaction types or unconfirmed assignments
can match category/merchant filters, and merchant description search can match
more than one description. Needs-confirmation counts cover spending rows while the
Transactions confirmation filter can also show other transaction types.

Real-data acceptance remains for the user; automated tests and screenshots use
synthetic data exclusively. No real financial files or database were inspected.

## Validation and visual review

- `npm run format`: completed; subsequent edited files were formatted with Prettier.
- `npm run typecheck`: passed, also repeated by the final build.
- `npm run lint`: passed.
- `npm run format:check`: passed.
- `npm run test:run -- --maxWorkers=1 --hookTimeout=60000`: 283 tests passed in 27 files.
- `npm run build`: passed.
- `git diff --check`: passed.

The full suite ran with one worker and a longer setup timeout after machine load
caused a database setup timeout during an earlier focused run. Early renderer-test
failures exposed limitations of the custom test host; test compilation now disables
static hoisting, and the host supports select control initialization. Final tests
have no expected-failure markers.

Added coverage checks financial classification consistency, signed refund shares,
category totals, disappearing categories, settlement counts, coverage metadata,
rendered summary/recurring values, supplied monthly values, missing/zero/one-month
states, category ordering and expansion, Unclassified visibility, keyboard actions,
drill-down destinations, theme/responsive structure, and period-request races.
Existing tests retain Visa double-counting and candidate-recurring exclusion checks.

The built renderer was inspected in a local headless browser using only synthetic
DTOs at 1440, 1100, and 760 pixels in dark mode, 1440 pixels in light mode, and 1100
pixels with the sidebar collapsed. Both upper and lower content were captured.
Document and main-content scroll widths matched their visible widths in every
case. Main-only scrolling remained intact. The first review prompted larger chart
labels and layout changes based on available content width; final screenshots were
re-inspected. Screenshots are in `/tmp/sampo-dashboard-review/`. The temporary
server and headless browser were stopped afterward.

Native Electron resizing and the user's real multi-month data acceptance checklist
remain to be verified by the user. Month-to-date comparison semantics, recurring
previous-period comparisons, exact spending-only drill-down filters, and transfer
detection remain deferred. No commit, push, dependency addition, or Phase 10 work
was performed.

## Files changed

- `docs/ARCHITECTURE.md`
- `docs/DASHBOARD_AUDIT.md`
- `src/main/dashboard/dashboard-analytics-service.ts`
- `src/main/dashboard/tests/dashboard-analytics-service.test.ts`
- `src/main/storage/transactions.ts`
- `src/shared/dtos.ts`
- `src/renderer/src/views/DashboardView.vue`
- `src/renderer/src/views/ImportsView.vue`
- `src/renderer/src/components/dashboard/MonthlyTrend.vue`
- `src/renderer/src/components/dashboard/CategorySpending.vue`
- `src/renderer/src/presentation/dashboard.ts`
- `src/renderer/src/stores/dashboard.ts`
- `src/renderer/src/assets/main.css`
- `src/renderer/src/tests/dashboard-contract.test.ts`
- `src/renderer/src/tests/dashboard-presentation.test.ts`
- `src/renderer/src/tests/helpers/dashboard-fixture.ts`
- `src/renderer/src/tests/helpers/render-host.ts`
- `vitest.config.ts`
