# EVO Visa Synthetic Fixtures

The automated tests generate temporary legacy BIFF `.xls` workbooks in memory from synthetic rows. Binary fixture files are not committed.

The generated data preserves only the technical shape needed by the importer:

- A completed movements header with `FECHA`, `COMERCIO/CAJERO`, `IMPORTE`
- A pending movements marker and matching header
- Excel serial dates
- Numeric EUR amounts where purchases are negative and refunds are positive

All merchant names, dates, and amounts are invented. Genuine statement rows, personal names, account/card identifiers, and real financial values must never be copied into this directory.
