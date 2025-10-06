# Analytics Calculation & Data Pipeline Plan

## 1. Insight Inventory and Current Behaviour

### 1.1 Dashboard API payload
- The `/api/analytics/dashboard` route builds a payload containing range metadata, accounting metrics, document progress, financial posture, salary navigator state, and lightweight AI insights.【F:backend/routes/analytics.js†L168-L256】
- Required document progress relies on a static checklist (`REQUIRED_DOC_TYPES`) and per-user `usageStats` counters for completed requirements.【F:backend/routes/analytics.js†L10-L159】
- Wealth posture tiles derive from the user’s stored `wealthPlan.summary` including asset allocation, liability schedules, cash reserves, projections, and affordability advisories.【F:backend/routes/analytics.js†L176-L239】

### 1.2 Personal finance analytics service
- The `computePersonalFinance` service normalises transactions from the JSON data store, selects the current and comparison ranges, and derives the analytics consumed by the dashboard UI.【F:backend/services/analytics/personalFinance.js†L55-L581】
- Core computations include spend & income categorisation, duplicate detection, merchant concentration, inflation-adjusted spend trend, wealth breakdown, savings capacity, HMRC allowance utilisation, and alert generation.【F:backend/services/analytics/personalFinance.js†L96-L371】【F:backend/services/analytics/personalFinance.js†L448-L573】

### 1.3 Front-end expectations
- `frontend/js/dashboard.js` expects KPI cards for income, spend, savings capacity, and HMRC balance, comparative rows vs the previous period, donut/line charts for spend categories and inflation trend, tables for merchants, duplicates, HMRC obligations, alerts, and top cost changes.【F:frontend/js/dashboard.js†L198-L404】
- The page also renders AI suggestions surfaced from analytics alerts and document progress counters in the accounting section.【F:frontend/js/dashboard.js†L171-L214】【F:frontend/js/dashboard.js†L216-L247】

## 2. Data Sources and Canonical Schemas

### 2.1 File-backed operational store
- JSON helpers mount `data/` and `uploads/` directories for semi-structured storage of accounts, transactions, holdings, price history, and the document index.【F:backend/src/store/jsondb.js†L1-L41】
- Seed transactions demonstrate the expected structure: `date`, signed `amount`, textual `category`, optional `accountId`, and optional `description` mapped to Plaid attributes.【F:data/transactions.json†L1-L88】

### 2.2 MongoDB domain models
- The `User` model embeds integrations, preferences (including delta mode and analytics range), wealth plan summary, salary navigator, and document usage stats that downstream analytics consume.【F:backend/models/User.js†L10-L151】
- `PlaidItem` and `Transaction` models (not shown) persist plaid linkage, while `VaultFile`/`VaultCollection` back uploaded documents referenced in usage stats.

### 2.3 Aggregated analytics schema (to formalise)
To support deterministic re-computation across environments (Render worker, Cloudflare Worker), introduce a structured aggregation contract:
- **Transactions fact**: `{ userId, accountId, source, date, amount, currency, category, description, merchantName, personalFinanceCategory, isPending, raw }`
- **Accounts dimension**: `{ userId, provider, accountId, type, subtype, balance, currency, lastSyncedAt }`
- **Document checklist state**: `{ userId, type, uploadedAt, metadata, isRequired }`
- **Wealth snapshot** (derived from `wealthPlan.summary`): `{ userId, asOf, assets: [...], liabilities: [...], liquidity, affordability, projections }`
- **Analytics result cache**: `{ userId, rangeKey, deltaMode, payload, computedAt, sourceWorker }`

## 3. Calculation Requirements

### 3.1 Range handling and caching
- Accept presets (`last-month`, `last-quarter`, `last-year`, `year-to-date`) or explicit dates, normalise to day boundaries, and derive a comparable previous range for deltas.【F:backend/routes/analytics.js†L20-L80】【F:backend/services/analytics/personalFinance.js†L81-L86】
- Tag each computation with a cache key `(userId, rangeKey, deltaMode)` to keep worker responses idempotent.【F:backend/services/analytics/personalFinance.js†L47-L404】

### 3.2 Cashflow & savings metrics
- Gross income, total spend, and monthly savings capacity derive from range-filtered transactions with essential categories influencing the savings note/alert copy.【F:backend/services/analytics/personalFinance.js†L118-L207】【F:backend/services/analytics/personalFinance.js†L418-L486】
- Net cash flow vs previous period fuels “money saved” and debt reduction estimates used in `usageStats`; align formulas between dashboard and background workers.【F:backend/routes/analytics.js†L93-L159】

### 3.3 HMRC obligations and allowances
- Annualise income by category, apply static allowance thresholds (personal, dividend, CGT, pension, ISA), compute utilisation %, and pro-rate estimated tax liability against observed HMRC payments to produce balance + alerts.【F:backend/services/analytics/personalFinance.js†L243-L323】【F:backend/services/analytics/personalFinance.js†L326-L371】
- Persist obligations (`payment on account`, `self assessment`) with due dates so UI tables remain consistent across compute environments.【F:backend/services/analytics/personalFinance.js†L293-L308】

### 3.4 Spend & income breakdowns
- Category aggregation uses signed sums and share-of-total for spend donuts, plus ranked merchants and top cost movers comparing current vs previous periods.【F:backend/services/analytics/personalFinance.js†L118-L223】【F:backend/services/analytics/personalFinance.js†L418-L556】
- Inflation trend indexes monthly outflows to CPI references; maintain CPI data file for easy updates and expose both nominal and real series.【F:backend/services/analytics/personalFinance.js†L17-L201】

### 3.5 Data quality checks & insights
- Duplicate transaction detection groups by (date, rounded amount, canonicalised description) and surfaces counts and affected accounts; reuse logic for reconciliation tasks.【F:backend/services/analytics/personalFinance.js†L96-L116】
- Alert builder fuses duplicates, savings deficits, allowance utilisation, spend concentration, and HMRC liability into severity-tagged insight cards consumed by the UI and AI suggestions.【F:backend/services/analytics/personalFinance.js†L326-L371】【F:frontend/js/dashboard.js†L171-L214】

### 3.6 Wealth posture & documents
- Combine wealth plan totals, asset mix weights, liability payoff schedule, and coverage ratio to populate financial posture panels and liquidity notes.【F:backend/routes/analytics.js†L176-L236】【F:backend/services/analytics/personalFinance.js†L423-L561】
- Document readiness requires reconciling uploaded file index entries with the mandatory checklist to compute progress %, outstanding count, and AI nudges.【F:backend/routes/analytics.js†L10-L215】

## 4. Data Pipelines & Worker Strategy

### 4.1 Daily Plaid synchronisation
- Existing sync worker iterates Plaid items, refreshes accounts, and upserts transactions while respecting freshness windows; today it runs as a long-lived Node interval.【F:backend/routes/plaid.js†L16-L200】【F:backend/services/plaidSyncWorker.js†L1-L205】
- To guarantee daily updates, schedule a cron-triggered Cloudflare Worker (or Render worker) that invokes an internal `/tasks/plaid-sync` endpoint which wraps `runPlaidSyncOnce({ force: true })`. Ensure idempotency by persisting `transactionsCursor` and `transactionsFreshUntil` before acknowledging completion.【F:backend/services/plaidSyncWorker.js†L151-L209】
- Store sync audit logs per item (`lastSyncAttempt`, `lastSuccessfulUpdate`, error message) for observability already exposed in Plaid route responses.【F:backend/routes/plaid.js†L57-L123】

### 4.2 Cloudflare Worker computation path
- Deploy a worker that, on schedule (e.g., hourly) or via HTTP, fetches the latest transactions/accounts from the API (or directly from MongoDB via a Durable Object binding), runs the personal finance compute, and writes the JSON result to the analytics cache collection.
- Because the existing service expects filesystem JSON, introduce an adapter that can source transactions either from MongoDB (`Transaction` model) or the JSON file so both Render and Cloudflare environments share the same pure computation module.
- Cloudflare strengths: lightweight cron triggers, global edge execution for quick on-demand recomputes, built-in KV for caching analytics payloads keyed by `(userId, range, deltaMode)`.

### 4.3 Render worker evaluation
- Render background worker can reuse current Node environment (access to filesystem, existing Mongoose connection, Plaid SDK) with minimal refactor. It suits heavier batch jobs (full backfills, wealth plan recompute) but has higher cold-start latency and fewer scheduling granularity options compared to Cloudflare.
- Decision: implement abstraction layer so both workers call `computePersonalFinance` and share the same persistence contract. Use Cloudflare for frequent, latency-sensitive recalculations (e.g., overnight refresh) and keep Render worker as fallback for large syncs or when Plaid SDK requires Node features unsupported by Workers runtime.

### 4.4 Data governance & observability
- Version analytics payloads by schema hash to detect drift between worker outputs; include `sourceWorker`, `computedAt`, and `inputVersion` in cached records.
- Log metric-level provenance (transaction IDs contributing to each category sum) for auditability — store references in a lightweight secondary collection for debugging.
- Ensure uploaded document index updates trigger document progress recompute by enqueueing a worker task whenever new files arrive.

## 5. Implementation Roadmap
1. **Abstract data access**: Replace direct JSON reads with a repository layer that can pull from MongoDB or file store; maintain compatibility for local development.【F:backend/services/analytics/personalFinance.js†L394-L581】
2. **Formalise schemas**: Create Mongoose schemas (or SQL tables) for analytics cache and document checklist states matching Section 2.3 to decouple compute from request handlers.
3. **Worker orchestration**: Expose `/internal/tasks/plaid-sync` and `/internal/tasks/analytics-recompute` endpoints, guard via service tokens, and wire Cloudflare Cron + Render worker to call them daily.
4. **Instrumentation**: Emit sync + compute telemetry (duration, processed transactions, errors) to a central log for monitoring.
5. **Backfill & validation**: Run initial worker-driven recompute across existing users, compare results to current dashboard responses, and reconcile any discrepancies before cutting over to worker-generated payloads.

This plan aligns existing UI expectations with backend computations, prepares consistent schemas for data from user input, uploads, and Plaid, and sets the stage for a worker-based analytics pipeline supporting both Cloudflare and Render environments.
