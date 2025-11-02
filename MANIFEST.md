# AI Accountant Platform — v2 Canonical Ingest

## Authentication
- **WorkOS AuthKit** — untouched implementation lives in `backend/routes/auth.js`. The Express server mounts it at `/api/auth/*` and `/callback`.

## Application Shell
- **Landing page** (`frontend/public/index.html`) — public marketing page with WorkOS sign-in links and favicon (served from backend via inline PNG).
- **Protected app** lives under `/app/*` and is rendered from static HTML in `frontend/app/`. Guarded client-side via `/api/v2/me` and server-side via `ensureAuthenticated` middleware.
  - `dashboard.html`, `documents.html`, `analytics.html`, `advice.html`, `tax.html`, `profile.html` with shared styling (`app/css/app.css`) and API helpers (`app/js/app.js`).

## Backend (Express + MongoDB + Cloudflare R2)
- **Entry point**: `backend/index.js` bootstraps the v2 server from `src/v2/app.js`, mounts WorkOS auth, and listens on `PORT`.
- **Config & env**: `backend/src/v2/config.js` requires Cloudflare R2, Docupipe, MongoDB, and OpenAI environment variables. Multi-tenant isolation enforced via `userId` on every query.
- **Mongo connection**: `backend/src/v2/models/index.js` centralises the Mongoose connection. Collections:
  - `DocumentInsight` (`document_insights`), `TransactionV2`, `PayslipMetricsV2`, `AccountV2`, `AnalyticsSnapshotV2`, `AdviceItemV1`, `DeadLetterJob`, `UploadBatch`, `IngestJob`.
- **Canonical schemas**: `backend/src/v2/schemas/*.js` define strict Ajv schemas for payslip, transaction, and statement v2 documents. Validators exported from `validation/schemas.js`.
- **R2 adapter**: `backend/src/v2/services/r2.js` issues presigned PUT/GET URLs, reads objects, and writes buffers/JSON under `users/<userId>/…`.
- **Docupipe integration**: `backend/src/v2/services/docupipe.js` dispatches workflow runs and polls until completion using `DOCUPIPE_*` env config.
- **Ingestion worker**: `backend/src/v2/services/ingestion/jobProcessor.js`
  - Handles PDF jobs and ZIP archives (via `backend/src/lib/zip.js`).
  - Computes content hashes, enforces idempotency, and records lineage provenance for every derived value.
  - Maps Docupipe payloads using `payslipMapper.js` and `statementMapper.js`, validates with Ajv, enforces invariants (net pay and balance equations), writes canonical data to MongoDB, and triggers analytics recomputation via `services/analytics.js`.
  - Streams structured worker logs and records failures to `dead_letter_jobs` with diagnostics. Requeue supported at `/api/v2/admin/dead-letters/:id/requeue`.
- **Analytics**: `backend/src/v2/services/analytics.js` recomputes monthly and tax-year snapshots, aggregates categories/commitments, and exposes summary/timeseries endpoints.
- **Advice**: `backend/src/v2/services/advice.js` builds prompt bundles from analytics snapshots, calls OpenAI (JSON mode), normalises responses to `advice_items_v1`, and stores model/prompt hashes plus provenance.
- **Profile service**: `backend/src/v2/services/profile.js` allow-list updates for first name, last name, country, interests.

## API Surface (`/api/v2/*` — all auth guarded)
- `GET/PATCH /me` — profile read/write (limited fields).
- `POST /vault/presign` — presigned R2 upload for PDF/ZIP (creates/updates `upload_batches`).
- `POST /vault/ingest` — enqueue uploaded files for Docupipe processing.
- `GET /vault/files` — list batches, files (including ZIP child statuses), and dead-letter jobs.
- `GET /analytics/summary|timeseries|categories|commitments` — analytics snapshots.
- `GET /advice`, `POST /advice/rebuild` — retrieve/regenerate OpenAI advice with provenance.
- `GET /tax/snapshot`, `POST /tax/bundle` — tax-year analytics bundles.
- `POST /admin/dead-letters/:id/requeue` — requeue failed jobs (same tenant only).

### Upload → Insight Flow
1. Client uploads PDF/ZIP via presigned URL to Cloudflare R2 under `users/<userId>/<batch>/<file>/…`.
2. `/vault/ingest` records an `IngestJob` and pushes to an in-process queue limited by `MAX_DOCUPIPE_IN_FLIGHT`.
3. Worker downloads from R2. ZIP archives are unpacked, PDFs stored back to R2, and child jobs queued.
4. Docupipe workflow runs; canonical v2 JSON mapped + validated.
5. Canonical data persisted with provenance, transactions/payslips/accounts normalised, analytics snapshots recomputed for affected periods only, advice remains untouched until requested.
6. Failures enter `dead_letter_jobs` without contaminating analytics; users can requeue.

## Frontend Features
- **Dashboard** — latest analytics snapshot, document count, rolling six-month table.
- **Documents** — upload PDF/ZIP, live status per file and child entries, dead-letter retry.
- **Analytics** — current month metrics, category leaderboard, commitments, monthly trend table.
- **Advice** — displays stored OpenAI guidance with severity/confidence and provenance tags, regenerate button.
- **Tax** — dropdown of tax years with metrics and table of all snapshots.
- **Profile** — edit first/last name, country, interests (comma-separated), persists via `/api/v2/me`.

## Static Assets
- `frontend/assets/landing-visual.svg`, `fonts.css`, and inline favicon handler for zero 404s.

## Observability
- Worker logs via `createLogger` in `utils/logger.js`, including structured stage events `{ jobId, userId, fileId, stage, result }`, and DLQ entries for diagnostics. Metric counters (processed/skipped/failed/deadLettered) can be scraped from `services/ingestion/jobProcessor`.

---
This manifest supersedes previous GridFS/legacy documentation and reflects the v2 multi-tenant ingest + analytics architecture.
