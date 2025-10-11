// NOTE: Align with docs/MASTER_SPEC.md — all ingestion, analytics, UX, types, and ops MUST conform.
# Phloat Smart Document Vault & Analytics — Master Architecture and Data Schema (CIM)

**Version:** 1.0 • **Schema/CIM Version:** v1 • **Date:** 2025-10-09

This document is the single source of truth for the Smart Document Vault and Analytics system. It merges the architecture specification and the Canonical Information Model (CIM) / data contracts used from ingestion through to dashboards.

---

## 0) Platform & Scope

- **Render Web Service**: Frontend + API.
- **Render Background Workers**: Asynchronous processing.
- **Cloudflare R2**: Durable storage for raw documents (PDF).
- **MongoDB (Mongoose)**: Source of truth for insights, accounts, aggregates.
- **OpenAI API**: Optional LLM extraction; **heuristics-first** path must stand alone.
- **Accepted Uploads**: **PDF only** (reject all others with a readable message).

---

## 1) Non-Negotiable Principles

- **PDF-only intake**. If prior ZIP logic exists, fence it off and return a friendly rejection.
- **Strict typing & validation**: Ajv JSON Schemas with `coerceTypes: true`. All money stored as **minor units** integers.
- **Idempotency & versioning**: `(contentHash, parserVersion, promptVersion)` gate reprocessing.
- **Determinism**: Aggregations are pure functions; results reproducible.
- **Performance**: Precompute period aggregates; index for query shapes; cache hot ranges.
- **Observability**: Status surfaces at each stage; consistent staged loader messaging; explicit failure state text `"failed"`.

---

## 2) Global Conventions

- **Casing**: camelCase JSON keys.
- **Dates**: ISO strings `YYYY-MM-DD` (logical-local; no time).
- **Periods**:
  - Month key: `YYYY-MM`
  - Quarter key: `YYYY-Q{1..4}` with **Q1 = Jan–Mar**
  - Period object: `{ start, end, month, quarter, label }` where `start` inclusive and `end` exclusive for computations.
- **Money**:
  - Use **minor units** integers: `amountMinor` (pence/cents).
  - Always include `currency` (ISO 4217). For multi-currency, also store:
    - `homeCurrency`, `fxRateToHome`, `amountHomeMinor`.
- **Versioning**: Persist `version: 'v1'` in all envelopes/documents.

---

## 3) Common Information Model (CIM) — Types

> Use these **everywhere**: parsers → DocumentInsight → rollups → API → UI datasets.

### 3.1 Account
```ts
interface AccountV1 {
  id: string;
  name: string;
  institution?: string|null;
  currency: string; // 'GBP' by default
  type: 'current'|'savings'|'credit'|'investment'|'pension'|'cash'|'other';
  meta?: Record<string, unknown>;
}
```

### 3.2 Transaction
```ts
interface TransactionV1 {
  id: string;                     // stable
  date: string;                   // 'YYYY-MM-DD'
  description: string;
  amountMinor: number;            // signed integer; negative=outflow
  direction: 'inflow'|'outflow';
  category: string;               // canonical set (see §8)
  accountId?: string;
  accountName?: string;
  merchant?: string|null;
  currency: string;               // ISO 4217
  homeCurrency?: string;          // if different
  fxRateToHome?: number;          // e.g., 1.12
  amountHomeMinor?: number;       // precomputed in homeCurrency
  meta?: Record<string, unknown>;
}
```

### 3.3 Payslip Metrics
```ts
interface PayslipMetricsV1 {
  payDate: string;                // 'YYYY-MM-DD'
  period: { start: string; end: string; month: string; quarter: string };
  employer?: string|null;
  grossMinor: number;
  netMinor: number;
  taxMinor?: number;
  nationalInsuranceMinor?: number;
  pensionMinor?: number;
  studentLoanMinor?: number;
  taxCode?: string|null;
  payFrequency?: 'weekly'|'biweekly'|'fourweekly'|'monthly'|'quarterly'|'annual'|'other';
  confidence?: number;            // 0..1
  extractionSource: 'heuristic'|'llm'|'ocr';
}
```

### 3.4 Statement Metrics
```ts
interface StatementMetricsV1 {
  period: { start: string; end: string; month: string; quarter: string };
  accountId?: string;
  incomeMinor: number;            // Σ inflows
  spendMinor: number;             // Σ outflows (absolute)
  netMinor: number;               // inflow - outflow (signed)
  topCategories: Array<{ category: string; inflowMinor: number; outflowMinor: number }>;
  transactions: TransactionV1[];
  extractionSource: 'heuristic'|'llm'|'ocr';
  confidence?: number;
}
```

### 3.5 Document Insight (per file)
```ts
interface DocumentInsightV1 {
  id: string;                     // doc id
  userId: string;
  catalogueKey: 'payslip'|'current_account_statement'|'other';
  documentMonth: string;          // 'YYYY-MM'
  quarter: string;                // 'YYYY-Qn'
  contentHash: string;            // sha256 of raw PDF
  parserVersion: string;          // e.g., 'p1'
  promptVersion: string;          // e.g., 'p1'
  createdAt: string;              // ISO date-time
  payslip?: PayslipMetricsV1;
  statement?: StatementMetricsV1;
  reconciledTransactionId?: string; // payslip->statement inflow within ±7d
  meta?: Record<string, unknown>;
  version: 'v1';
}
```

### 3.6 User Insights Envelope (roll-up for dashboards)
```ts
interface InsightsEnvelopeV1 {
  sources: {
    payslip?: DocumentInsightV1[];
    current_account_statement?: DocumentInsightV1[];
    [key: string]: DocumentInsightV1[];
  };
  aggregates: {
    income?: { grossMinor?: number; netMinor?: number; notes?: string[] };
    cashflow?: {
      incomeMinor: number;
      spendMinor: number;
      categories: { category: string; inflowMinor: number; outflowMinor: number }[];
      largestExpenses: { description: string; amountMinor: number; date: string; category?: string }[];
      accounts: Array<{ accountId: string; totals: { incomeMinor: number; spendMinor: number } }>;
    };
  };
  timeline: Array<{
    period: { start: string; end: string; month: string; quarter: string; label: string };
    payslip?: { grossMinor?: number; netMinor?: number; taxMinor?: number; niMinor?: number; payDate?: string };
    statements?: { incomeMinor: number; spendMinor: number; netMinor: number };
  }>;
  processing?: Record<string, unknown>;
  version: 'v1';
}
```

### 3.7 Dashboard Datasets (API → UI)

**Query (time range picker):**
```
/api/analytics/dashboard?granularity=month|quarter|year&start=YYYY-MM&end=YYYY-MM&homeCurrency=GBP
```

**Summary tiles**
```ts
interface DashboardSummaryV1 {
  period: { start: string; end: string; granularity: 'month'|'quarter'|'year' };
  totals: { incomeMinor: number; spendMinor: number; netMinor: number };
  topCategories: Array<{ category: string; outflowMinor: number; inflowMinor: number }>;
  accounts: Array<{ accountId: string; name?: string; incomeMinor: number; spendMinor: number }>;
  version: 'v1';
}
```

**Time series**
```ts
interface TimeSeriesPointV1 { ts: string; valueMinor: number; } // 'YYYY-MM-DD'
interface TimeSeriesV1 {
  metric: 'income'|'spend'|'net'|'balance';
  granularity: 'day'|'week'|'month';
  series: TimeSeriesPointV1[];
  paydayEvents?: Array<{ ts: string; amountMinor: number; source: 'payslip'; employer?: string|null }>;
  version: 'v1';
}
```

**Quarterly aggregates (Q1=Jan)**
```ts
interface QuarterlyAggregateV1 {
  quarter: string;                // 'YYYY-Qn'
  months: string[];               // ['YYYY-MM','YYYY-MM','YYYY-MM']
  totals: { incomeMinor: number; spendMinor: number; netMinor: number };
  topCategories: Array<{ category: string; outflowMinor: number; inflowMinor: number }>;
  version: 'v1';
}
```

---

## 4) Canonical Categories (single source)

```
Income, Groceries, EatingOut, Utilities, RentMortgage, Transport, Fuel, Entertainment, Subscriptions, Health,
Insurance, Education, Travel, Cash, Transfers, DebtRepayment, Fees, GiftsDonations, Childcare, Home, Shopping, Misc
```

- Unknowns normalise to `'Misc'`.
- **Transfers** are internal moves; exclude from **Spend.total** but include in **Cashflow**.

---

## 5) Pipeline — End to End

### Intake (Web/API)
1. **Accept** PDF only. Reject other types with readable error.
2. **Persist** raw PDF to R2 under user-scoped key prefix.
3. **Compute** `contentHash` (sha256) at intake.
4. **Create** job record with `(contentHash, parserVersion, promptVersion)`.

### Processing (Worker)
1. **Health**: web probes worker `/healthz`. If unhealthy, the API runs a **synchronous** fallback (classify → extract → validate → apply → aggregate).
2. **Guard**: verify PDF; idempotency check — skip if unchanged.
3. **Classify** (cheap LLM optional) → `{ type, confidence }` with threshold `≥ 0.6`; else **reject** with reason.
4. **Extract**:
   - Heuristics-first (regex/table parsers).
   - Optional LLM extraction (merge only validated fields).
   - Optional OCR fallback for text-poor PDFs.
5. **Normalise**: ISO dates, amounts to `amountMinor`, directions, canonical categories, account linking/creation.
6. **Persist**: upsert `DocumentInsightV1`.
7. **Aggregate**:
   - Monthly aggregate for `documentMonth` and update **InsightsEnvelopeV1**.
   - Reconciliation: payslip `netMinor` ↔ statement inflow within ±7 days.
8. **Status**: mark job succeeded/failed/rejected; surface reason.

### Loader UX (every page)
Staged messages shown verbatim:
1. "Uploading to secure storage"
2. "Classifying document"
3. "Extracting data"
4. "Validating results"
5. "Updating analytics"
6. "Finalising"
- On success: dismiss using existing Loan/Contract success visuals.
- On any error: show exact text **"failed"** and the server-provided reason beneath.
- Accessibility: do not use `aria-hidden` on focused nodes; prefer `inert` while loading; restore focus after completion.

---

## 6) Aggregation Rules

### Monthly (all document types)
- **Income**:
  - `gross = Σ(payslip.grossMinor)`
  - `net = Σ(payslip.netMinor)`
  - `other = Σ(statement inflows categorised as Income not matched to payslips)`
- **Spend**:
  - `total = Σ(outflows where category != Transfers)`
  - `byCategory = group outflows by category with share = outflow / total`
- **Cashflow**: `incomeMinor − spendMinor`
- **Savings/Investments/Pension**: take month-end balances; contributions and returns when available.
- **Tax**:
  - `withheld = Σ(payslip.taxMinor + nationalInsuranceMinor + studentLoanMinor?)`
  - `paidToHMRC = Σ(statement outflows with HMRC keywords)`
  - `effectiveRate = (withheld + paidToHMRC) / max(grossMinor, 1)`

### Quarterly (Q1 = Jan–Mar)
- Aggregate the three monthly results in the quarter:
  - `Quarter.totals = Σ(Month.totals)`
  - `topCategories`: aggregate and sort across months.
- Persist materialised `QuarterlyAggregateV1` for performance.

### Time Series
- Build from canonical transactions and payslip events:
  - `/timeseries?metric=income|spend|net&granularity=day|week|month&start&end`
  - Include `paydayEvents` from payslips (`payDate`, `netMinor`).

---

## 7) APIs (Contracts)

- `GET /api/analytics/dashboard?granularity=month|quarter|year&start=YYYY-MM&end=YYYY-MM&homeCurrency=GBP` → `DashboardSummaryV1`.
- `GET /api/analytics/timeseries?metric=spend&granularity=day&start=YYYY-MM-01&end=YYYY-MM-31` → `TimeSeriesV1`.
- `GET /api/analytics/quarterly?year=YYYY` → `QuarterlyAggregateV1[]`.

Reads prefer `user.documentInsights` (v1 envelope), else monthly/quarterly materialised aggregates, else legacy (mapped via a thin adapter).

---

## 8) Validation & Schemas

- Ajv validators at `shared/schemas/*.schema.json` for:
  - `TransactionV1`, `PayslipMetricsV1`, `StatementMetricsV1`,
  - `DocumentInsightV1`, `InsightsEnvelopeV1`,
  - `DashboardSummaryV1`, `TimeSeriesV1`, `QuarterlyAggregateV1`.
- Coercions at boundaries:
  - Money → `amountMinor` (integer).
  - Dates → `'YYYY-MM-DD'`.
  - Categories → canonical set; unknowns → `'Misc'`.

---

## 9) Indexing, Caching, Performance

- **Mongo indexes**:
  - `DocumentInsight`: `(userId, documentMonth)`, `(userId, quarter)`, `(userId, contentHash)`, `(userId, createdAt)`.
  - `UserAnalytics` (if retained): `(userId, periodKey)`.
- **Caching**:
  - In-memory LRU (5–15 min) on summary/timeseries responses.
  - Cache key includes `(userId, start, end, granularity, homeCurrency)`.
- **Compute**:
  - Use integers (minor units) for arithmetic; format at the view layer.
  - Consider streaming parsers for large PDFs.

---

## 10) Security, Privacy, Deletion

- All R2 operations server-side; never expose credentials.
- Authorise all endpoints and filter by `userId`.
- PII minimisation: store only required fields.
- Support deletion with rebuild of aggregates.

---

## 11) Testing & Acceptance

- **Unit**: normalisers, category mapping, reconciliation, Ajv schema checks, period helpers.
- **Integration**: upload → process (async/sync) → persist → aggregate → dashboard.
- **Regression**: snapshot tiles and top categories across seeded months.
- **Perf**: seeded month (≥5k tx) should serve dashboard < 300ms p95.

**Acceptance examples**
1) Re-upload identical PDF → idempotent skip; no duplicate insights.
2) Payslip → deposit reconciliation within ±7 days when data aligns.
3) Mixed bank institutions correctly aggregate `Groceries` and `Transfers`.
4) Loader states match backend phases; on error loader text is exactly `"failed"`.

---

## 12) Backward Compatibility & Migration

- Rename `spendingCanteorgies` → `spendingCategories` (keep a temporary read shim).
- Provide a migration script to coerce legacy shapes into CIM v1:
  - Convert amounts to `amountMinor`.
  - Force ISO dates and period keys.
  - Normalise categories.
  - Stamp `version: 'v1'`.

---

## Secrets & Flags

- **Environment template**: copy `.env.example` to `.env` and replace placeholders with environment-specific values. Never commit live secrets.
- **Frontend flip**: keep `ENABLE_FRONTEND_ANALYTICS_V1=true` and `ENABLE_STAGED_LOADER_ANALYTICS=true` so dashboards default to v1 data and staged messaging.
- **Legacy safety**: retain `ENABLE_ANALYTICS_LEGACY=true` during rollout; set to `false` only after verifying the v1 dashboard.
- **Ajv strictness**: default `ENABLE_AJV_STRICT=false` (warn-only). Once the frontend flip is validated, set it to `true` to enforce schema errors server-side.

---

## Phase-3 QA Harness

- **Run**: `npm run qa:phase3` (defaults to `http://localhost:3000` with the current year range). Override the base URL or window with `--base`, `--start`, `--end`, `--granularity`, and `--token` CLI flags.
- **Recommended dev flags**: set `ENABLE_FRONTEND_ANALYTICS_V1=true` and `ENABLE_STAGED_LOADER_ANALYTICS=true` before starting the backend. Keep `ENABLE_AJV_STRICT=false` until the frontend flip is verified, then enable strict mode and optionally set `ENABLE_ANALYTICS_LEGACY=false` for v1-only dashboards.
- **Expected output**:
  - Each `/api/analytics/v1/*` call returns `200`, validates against the v1 schemas, and reports ISO dates, integer minor units, and canonical categories.
  - The repeated summary call prints cache behaviour ("cache: likely" when a hit header or ≥30% latency improvement is observed).
  - Dev-only validation flow: `GET /__qa__/emitInvalidV1` followed by `POST /__qa__/validate/summary` → `422` with `{ code: 'SCHEMA_VALIDATION_FAILED', details: [...] }`.
- **Common failures**:
  - Missing feature flags → 404/legacy responses; re-run with the required env vars.
  - Authentication gaps → harness prints `status 401`; supply `--token=<jwt>`.
  - Ajv strict disabled → dev validator returns `200`; harness reports "expected 422".

---

**End of MASTER SPEC.**

