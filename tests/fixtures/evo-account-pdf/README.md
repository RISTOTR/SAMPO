# EVO Account PDF Synthetic Fixtures

Phase 3 tests generate deterministic text-based PDFs at runtime with `pdf-lib`.

The generated statements preserve only the technical structure needed by the parser:

- repeated account statement and table headers
- positioned transaction columns
- opening, carried and final balance rows
- debit, credit and resulting balance columns
- a synthetic Visa settlement description
- a separated trailing minus sign case

The fixtures use invented names, references, dates and amounts. Real account statements, account
identifiers, references, descriptions and balances must never be copied here.
