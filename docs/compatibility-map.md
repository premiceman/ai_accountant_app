# Compatibility Map: Analytics & Document Pipeline Overhaul

## Current Endpoint Surface vs Target Changes
| Current route | Responsibility today | Planned endpoint/state | Notes |
| --- | --- | --- | --- |
| `GET /api/analytics/dashboard`【F:backend/routes/analytics.js†L9-L123】【F:backend/routes/analytics.js†L200-L234】 | Builds dashboard payload directly from `User` document plus filesystem JSON helpers (transactions, docs index) and returns empty stubs for most analytics arrays. | Same route, but should become a thin controller that validates range params, reads cached analytics from `AnalyticsCache`, and triggers background recompute when stale via `/\_internal/analytics/recompute`. | Needs schema-hash validation, provenance metadata, and cache freshness enforcement per the plan.【F:docs/analytics-calculation-plan.md†L61-L86】【F:docs/analytics-calculation-plan.md†L169-L201】 |
| `GET /api/vault/...` & `POST /api/vault/upload` (R2-backed)【F:backend/src/routes/vault.routes.js†L13-L231】 | Handles document upload, collection management, and cataloguing with direct `User.usageStats` updates. | Continue to serve upload UX but, after successful R2 write, call `POST /\_internal/docs/ingest` to enqueue ingest/validation and let workers update `VaultFile` + `DocChecklist`. | Requires passing user + object key to worker, plus antivirus scan + validation hooks before analytics recompute. |
| `POST /api/plaid/sync` (if exposed) & background `plaidSyncWorker.startPlaidSyncWorker`【F:backend/index.js†L118-L137】【F:backend/services/plaidSyncWorker.js†L1-L209】 | Performs in-process Plaid syncs on an interval. | Replace manual interval with internal task API `POST /\_internal/plaid/sync` called by Render cron/worker. Keep existing Plaid routes for setup. | Stub job should no-op without Plaid keys but keep audit logging.【F:docs/analytics-calculation-plan.md†L117-L153】 |
| `GET /api/user/preferences` & `PATCH /api/user/preferences` (via dashboard)【F:frontend/js/dashboard.js†L33-L78】 | Stores preferred delta mode/range in Mongo `User.preferences`. | Keep endpoints unchanged but ensure workers respect stored range/delta defaults when computing caches. | Cache key should include `(userId, rangeKey, deltaMode)` to match plan.【F:docs/analytics-calculation-plan.md†L61-L86】 |
| `GET /api/summary` & `GET /api/ai` (dashboard adjuncts) | Provide supplementary insights/AI messaging today. | Remain read-only; new analytics alerts feed should populate `aiInsights` array so `/api/ai` keeps working without duplication. | Need to deduplicate AI suggestions vs analytics alerts to avoid double messaging. |

### New Internal Endpoints to add (token-gated)
- `POST /_internal/docs/ingest` → enqueue `doc:ingest` job for `{ userId, key }`.
- `POST /_internal/analytics/recompute` → enqueue analytics recompute for `{ userId, rangeKey?, deltaMode? }` with idempotency token.
- `POST /_internal/plaid/sync` → stub job for future Plaid polling.

## Front-end Data Expectations vs Target Payloads
| UI consumer | Current expectation (shape) | Worker-derived payload requirement |
| --- | --- | --- |
| KPI cards (`#kpi-income`, `#kpi-spend`, `#kpi-savings`, `#kpi-hmrc`)【F:frontend/js/dashboard.js†L205-L222】 | Array `accounting.metrics` with entries keyed `income`, `spend`, `savingsCapacity`, `hmrcBalance`, each providing `value`, `format`, optional `delta`, `deltaMode`, `subLabel`. Currently mostly empty. | Populate from worker `cashflow` + `savingsCapacity` modules with deltas computed vs comparable range. HMRC card pulls from `hmrc.balance` payload including outstanding tax. |
| Comparatives ribbon (`comparison-label`, `delta buttons`)【F:frontend/js/dashboard.js†L198-L215】 | `accounting.comparatives` with `label`, `mode`, `values` (per-metric deltas). | Worker should pre-compute friendly labels (`vs previous period`, `vs prior year`) and supply both absolute & percent deltas based on user preference. |
| Spend donut + table (`spendByCategory`)【F:frontend/js/dashboard.js†L223-L249】 | Array of `{ category, label, amount, share }`. | Derived from transactions classification (categories & merchants), ensuring share sums to 1 and filtered by date range with delta context for cost movers. |
| Inflation trend chart (`inflationTrend`)【F:frontend/js/dashboard.js†L250-L280】 | Array of `{ label, nominal, real }`. | Worker must compute CPI-adjusted series using stored CPI data and surface `range` metadata for time axis. |
| Merchants list (`accounting.merchants`) & duplicates table (`accounting.duplicates`)【F:frontend/js/dashboard.js†L281-L332】 | Arrays of top spend merchants and duplicate groups with amounts/counts. | Produced by `merchants/duplicates` analytics module with deterministic ordering and tie-breaking. |
| HMRC obligations table (`accounting.obligations`) + gauge tiles (`accounting.allowances`)【F:frontend/js/dashboard.js†L333-L369】 | Obligations array with `dueDate`, `title`, `amountDue`; allowances array with `{ label, used, total }`. | Worker `hmrc` module should aggregate payments vs allowances, compute liability balance, and populate gauge usage percentages. |
| Alert queue & AI suggestions (`accounting.alerts`, `aiInsights`)【F:frontend/js/dashboard.js†L370-L404】【F:frontend/js/dashboard.js†L120-L174】 | Alert cards with `severity`, `title`, `body`; AI suggestions optionally duplicate alerts. | `dqAlerts` module should emit structured alerts (duplicates, savings shortfall, allowance nearing limit, etc.) along with provenance metadata for AI re-use. |
| Financial posture widgets (`financialPosture`)【F:frontend/js/dashboard.js†L405-L482】 | Object containing `netWorth`, `breakdown` (assets/liabilities), `liquidity`, `savings`, `assetMix`, `topCosts`, etc., today sourced from `User.wealthPlan.summary`. | Worker `wealth` module must merge wealth plan snapshot with transaction-derived savings capacity, doc progress, and highlight cost movers relative to previous range. |
| Document checklist progress (`accounting.documents`)【F:backend/routes/analytics.js†L210-L220】 | Simple counts for required/helpful docs based on static list. | Backed by `DocChecklist` & `VaultFile.validation` progress with quality flags, percent complete, and outstanding doc descriptions. |

## Environment Variables to Introduce
| Variable | Purpose | Notes |
| --- | --- | --- |
| `INTERNAL_TASK_SECRET` | Shared secret for header auth on `/_internal` routes. | Use `Authorization: Bearer <token>` check server-side. |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE` | Configure Cloudflare R2 client + signed URL host. | Supersede `R2_S3_ENDPOINT`; keep backward-compatible fallback during migration.【F:docs/analytics-calculation-plan.md†L21-L41】 |
| `MONGODB_URI` | Connection string for Mongo-backed worker outbox and analytics collections. | Scope credentials to required collections only. |
| `WORKER_METRICS_API_KEY` | Optional metrics push gateway token for job telemetry. | Enables observability per plan requirements. |
| `CLAMAV_HOST` / `CLAMAV_PORT` (or provider equivalent) | Antivirus scan endpoint for ingest pipeline before parsing. | Worker should short-circuit if not configured but log requirement. |
| `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` (existing) | Keep for Plaid readiness; feature-flag job should detect absence and no-op. | Already referenced today; document for completeness.【F:backend/utils/plaidConfig.js†L16-L53】 |

## Minimal Migration Steps
1. **Model rollout**: Introduce `VaultFile`, `DocChecklist`, and `AnalyticsCache` Mongo schemas with required indices before enabling worker writes. Backfill from existing `User.usageStats` + JSON docs.
2. **R2 client upgrade**: Deploy `lib/r2.ts` with new env vars, update backend upload path to record object keys + SHA-256, and ensure Cloudflare Worker can presign downloads.
3. **Queue infrastructure**: Provision Mongo outbox collections, deploy new `services/worker` container, and configure `/\_internal` secrets.
4. **Analytics cache cut-over**: Modify `/api/analytics/dashboard` to read from `AnalyticsCache`, trigger recompute on cache miss, and keep serving last-known-good payload to UI.
5. **Front-end adjustments**: Keep existing components but wire UI to show background refresh indicators and validation badges sourced from new payload fields.
6. **Operational setup**: Configure Render cron schedules (15m incremental, daily full recompute), Cloudflare Worker for signed R2 access, and run updated CI/CD (lint/typecheck/tests) before release.

## Identified Gaps / TODO Targets
- Need schema hashing + provenance stamps on cached analytics payloads (commit hash, module versions) to detect drift.【F:docs/analytics-calculation-plan.md†L86-L111】
- Document validation currently only tallies by filename; ingest pipeline must enrich with detected doc types, page counts, and matching against checklist rules.【F:backend/src/routes/vault.routes.js†L132-L215】
- Range handling & delta computation live in multiple places (frontend local state vs backend). Extract reusable module to keep worker/controller parity.【F:frontend/js/dashboard.js†L24-L110】【F:backend/routes/analytics.js†L17-L79】
