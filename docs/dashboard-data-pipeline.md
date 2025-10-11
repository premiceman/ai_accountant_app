# Dashboard Data Pipeline

This document explains the JSON artefacts generated from uploaded documents, the derived files that power the dashboard panels, and the storage / orchestration approach for both Render + MongoDB and Cloudflare + KV/R2 deployments.

## 1. Source document JSON contracts

Every PDF or statement that is processed produces a canonical JSON payload stored alongside the raw file. The JSON filename mirrors the PDF filename with a `.json` extension (e.g. `2025-01_acme_payslip.pdf` → `2025-01_acme_payslip.json`). The JSON is written into an R2 bucket (or GridFS/Mongo for interim staging) and indexed in MongoDB for lookup.

### Payslips (`payslip` catalogue)
```json
{
  "documentName": "2025-01_acme_payslip.pdf",
  "catalogueKey": "payslip",
  "period": { "start": "2025-01-01", "end": "2025-01-31", "month": "2025-01" },
  "payDate": "2025-01-28",
  "employer": "Acme Ltd",
  "grossMinor": 458000,              // integer minor units (pence)
  "netMinor": 325500,
  "taxMinor": 98200,
  "niMinor": 61200,
  "pensionMinor": 20000,
  "studentLoanMinor": 12000,
  "taxCode": "1257L",
  "effectiveMarginalRate": 0.37,
  "expectedMarginalRate": 0.35,
  "earnings": [
    { "label": "Base salary", "amountMinor": 400000 },
    { "label": "Bonus", "amountMinor": 58000 }
  ],
  "deductions": [
    { "label": "Income tax", "amountMinor": 98200 },
    { "label": "National insurance", "amountMinor": 61200 },
    { "label": "Pension", "amountMinor": 20000 }
  ]
}
```

### Current & savings account statements (`current_account_statement`, `savings_account_statement`)
```json
{
  "documentName": "2025-01_monobank_current.pdf",
  "catalogueKey": "current_account_statement",
  "period": { "start": "2025-01-01", "end": "2025-01-31", "month": "2025-01" },
  "accountId": "monobank-chq-1234",
  "accountName": "Monobank Current",
  "currency": "GBP",
  "transactions": [
    { "id": "txn-001", "date": "2025-01-02", "description": "Salary", "amountMinor": 325500, "direction": "inflow", "category": "Salary" },
    { "id": "txn-002", "date": "2025-01-10", "description": "Rent", "amountMinor": -120000, "direction": "outflow", "category": "Housing" }
  ],
  "metrics": {
    "inflowsMinor": 475500,
    "outflowsMinor": 330000,
    "netMinor": 145500
  }
}
```

### Investment / ISA statements (`investment_statement`, `isa_statement`)
```json
{
  "documentName": "2024-Q4_vanguard_isa.pdf",
  "catalogueKey": "isa_statement",
  "period": { "start": "2024-10-01", "end": "2024-12-31", "quarter": "2024-Q4" },
  "accountId": "vanguard-isa-9876",
  "positions": [
    { "symbol": "VWRL", "quantity": 12.5, "valueMinor": 965000 },
    { "symbol": "VUKE", "quantity": 8.0, "valueMinor": 512000 }
  ],
  "contributionsMinor": 600000,
  "withdrawalsMinor": 0,
  "valuationMinor": 1477000
}
```

### Credit & loan statements (`loan_statement`, `credit_card_statement`)
```json
{
  "documentName": "2025-01_mortgage_statement.pdf",
  "catalogueKey": "loan_statement",
  "period": { "start": "2025-01-01", "end": "2025-01-31" },
  "lender": "Nationwide",
  "loanType": "Mortgage",
  "balanceMinor": 21500000,
  "minimumPaymentMinor": 125000,
  "payments": [
    { "date": "2025-01-15", "amountMinor": 125000, "principalMinor": 80000, "interestMinor": 45000 }
  ]
}
```

## 2. Derived JSON aggregations

The ingestion worker builds secondary JSON documents that the dashboard reads. These are also stored in R2 (path prefix `analytics/`) and cached in MongoDB for fast retrieval.

### 2.1 Aggregated payslip rollups (`analytics/payslips/<preset>.json`)
```json
{
  "preset": "last-quarter",
  "period": { "start": "2024-10-01", "end": "2024-12-31" },
  "grossMinor": 1386000,
  "netMinor": 966000,
  "taxMinor": 294600,
  "niMinor": 183600,
  "pensionMinor": 60000,
  "studentLoanMinor": 36000,
  "effectiveMarginalRate": 0.375,
  "expectedMarginalRate": 0.35,
  "earnings": [ { "label": "Base salary", "amountMinor": 1200000 }, { "label": "Bonus", "amountMinor": 186000 } ],
  "deductions": [ { "label": "Income tax", "amountMinor": 294600 }, { "label": "NI", "amountMinor": 183600 } ]
}
```
*Used by:* Payslip analytics card, pay line bar charts, tax posture metrics, EMTR overlay.

### 2.2 Transaction timeseries (`analytics/timeseries/net/<granularity>.json`)
```json
{
  "metric": "net",
  "granularity": "month",
  "series": [
    { "ts": "2024-11-01", "valueMinor": 126500 },
    { "ts": "2024-12-01", "valueMinor": -45200 },
    { "ts": "2025-01-01", "valueMinor": 98500 }
  ]
}
```
*Used by:* Net cashflow trend card, fallback net worth trajectory when history is not present.

### 2.3 Spending breakdown (`analytics/spend/<preset>.json`)
```json
{
  "preset": "last-month",
  "totals": { "incomeMinor": 475500, "spendMinor": 330000 },
  "categories": [
    { "category": "Housing", "outflowMinor": 120000 },
    { "category": "Groceries", "outflowMinor": 68000 },
    { "category": "Transport", "outflowMinor": 28000 }
  ],
  "largestExpenses": [
    { "description": "Rent", "date": "2025-01-10", "amountMinor": 120000, "category": "Housing" }
  ],
  "duplicates": [
    { "date": "2025-01-22", "merchant": "Spotify", "amountMinor": 1299, "count": 2 }
  ],
  "accounts": [
    { "accountId": "monobank-chq-1234", "name": "Monobank Current", "incomeMinor": 325500, "spendMinor": 178000 }
  ]
}
```
*Used by:* Statement highlights, spend by category donut/table, largest outgoings list, duplicate detection.

### 2.4 Asset / liability snapshot (`analytics/networth/<date>.json`)
```json
{
  "asOf": "2025-01-31",
  "netWorthMinor": 24580000,
  "assets": [
    { "label": "Current accounts", "valueMinor": 2850000 },
    { "label": "Savings", "valueMinor": 4200000 },
    { "label": "Investments", "valueMinor": 11830000 },
    { "label": "Property", "valueMinor": 6200000 }
  ],
  "liabilities": [
    { "label": "Mortgage", "valueMinor": 21500000 },
    { "label": "Credit cards", "valueMinor": 240000 }
  ],
  "history": [
    { "label": "2024-11", "valueMinor": 23800000 },
    { "label": "2024-12", "valueMinor": 24120000 },
    { "label": "2025-01", "valueMinor": 24580000 }
  ]
}
```
*Used by:* Net worth trajectory line chart, donut, delta badge, asset distribution pie.

### 2.5 HMRC obligations & allowances (`analytics/tax/<preset>.json`)
```json
{
  "preset": "last-year",
  "allowances": [
    { "label": "Personal allowance", "usedMinor": 1257000, "totalMinor": 1257000 },
    { "label": "Dividend allowance", "usedMinor": 300000, "totalMinor": 500000 }
  ],
  "obligations": [
    { "title": "Self assessment balance", "dueDate": "2025-01-31", "amountMinor": 215000 }
  ],
  "hmrcBalanceMinor": 215000,
  "alerts": [
    { "severity": "warning", "title": "Payment on account due", "body": "£1,500 due on 31 Jan 2025" }
  ]
}
```
*Used by:* HMRC obligations table, allowance utilisation, accounting alerts panel.

## 3. Dashboard panel data requirements

| Panel | Expected JSON fields |
| --- | --- |
| **Payslip analytics** | `analytics/payslips/<preset>.json` → `grossMinor`, `netMinor`, `taxMinor`, `niMinor`, `earnings[]`, `deductions[]`, `effectiveMarginalRate`, `expectedMarginalRate` |
| **Pay line bar charts** | Same as above (`earnings[]`, `deductions[]`) aggregated to minor units |
| **Tax posture & EMTR** | `analytics/payslips/<preset>.json` for deductions + `annualisedGross`; EMTR curve generated client-side; overlays from `effectiveMarginalRate` and `expectedMarginalRate` |
| **HMRC obligations** | `analytics/tax/<preset>.json.obligations[]`, `hmrcBalanceMinor`, `allowances[]` |
| **Alerts** | `analytics/tax/<preset>.json.alerts[]` + affordability advisories |
| **Statement highlights** | `analytics/spend/<preset>.json.totals`, `categories`, `largestExpenses`, `accounts` |
| **Spend by category** | Same as above `categories[]` |
| **Inflation-adjusted trend** | `analytics/spend/<preset>.json.categories` + CPI overlay (ingestion service precomputes `inflationTrend[]` using public CPI series) |
| **Largest expenditures** | `analytics/spend/<preset>.json.largestExpenses[]` |
| **Duplicate transactions** | `analytics/spend/<preset>.json.duplicates[]` |
| **Net worth snapshot** | `analytics/networth/<date>.json.assets`, `liabilities`, `history`, `netWorthMinor` |
| **Net cashflow trend** | `analytics/timeseries/net/<granularity>.json.series[]` |
| **Asset distribution pie** | `analytics/networth/<date>.json.assets` grouped into current/savings/investments |
| **Affordability snapshot** | Derived from statement category totals plus recurring commitments heuristics stored in `analytics/spend/<preset>.json` |
| **Top cost drivers** | `analytics/spend/<preset>.json.categories[]` with `changePct` computed against previous preset |

## 4. File naming & lineage

1. **Raw PDF upload** → stored as `<uuid>.pdf` in R2 / GridFS.
2. **Parsed JSON** → `<original-filename>.json` stored in `documents/` prefix.
3. **Aggregated window** → `analytics/<metric>/<preset>.json` (e.g. `analytics/payslips/last-quarter.json`).
4. **Snapshot** → `analytics/networth/<yyyy-mm-dd>.json` keyed by closing date.
5. **Cache index** in MongoDB: each record stores `userId`, `documentName`, storage URI, checksum, processed timestamps.

## 5. Deployment reference architectures

### Option A — Render workers + R2 + MongoDB

- **Render worker service**: runs the ingestion pipeline (PDF parsing, JSON extraction, aggregation). Uses Render background jobs for reprocessing.
- **R2 bucket**: primary object storage for PDFs and JSON. Worker writes using R2 S3 API.
- **MongoDB Atlas**: metadata index (document catalogue, analytics cache state, user preferences).
- **Dashboard API (Node/Express)**: hosted on Render Web Service; fetches JSON either via Mongo cache or directly from R2.
- **Job flow**:
  1. User uploads via web → API stores PDF to R2, inserts Mongo document stub.
  2. Background worker pulls new uploads, produces parsed JSON + analytics JSON, uploads to R2, updates Mongo with pointers + checksums.
  3. Dashboard API serves GET `/api/analytics/v1/*` by streaming JSON from Mongo cache (or R2 fallback) and applying business transforms.

### Option B — Cloudflare Workers + KV/R2 (+ optional Mongo)

- **Cloudflare Worker (ingestion)**: triggered by R2 upload events or Cron. Runs the same parsing code (compiled to WASM/bundled) to emit JSON into R2.
- **Cloudflare R2**: identical storage layout (`documents/`, `analytics/`).
- **Cloudflare KV**: stores lightweight indexes and presets (e.g. last processed timestamp per user, pointers to analytics JSON).
- **Optional MongoDB**: only required if you need complex querying or historical lineage beyond KV's access patterns.
- **Dashboard worker**: HTTP Worker that serves `/api/analytics/v1/*`, reading from KV (metadata) and R2 (payload). KV cached responses allow sub-ms lookups; Worker streams JSON to the frontend.
- **Edge cache**: Cloudflare Cache API can be used to memoise aggregated JSON per user + preset with TTL aligned to reprocessing schedule.

Both options maintain the same JSON contracts and naming conventions, ensuring parity across environments.
