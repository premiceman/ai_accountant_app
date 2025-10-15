# Document Vault → DocuPipe Integration Plan

This plan expands the earlier high-level findings into fully specified implementation work. Each task is scoped for direct execution and references the concrete modules and behaviours identified in the existing codebase.

## 1. Replace legacy worker ingestion with DocuPipe-backed pipeline

### Objectives
- Stop enqueueing `UserDocumentJob` records from `backend/routes/vault.js`.
- Drive DocuPipe parse + standardise flow immediately after upload, mirroring `backend/src/routes/jsonTest.async.routes.js`.
- Persist per-file processing metadata (classification, trim status, DocuPipe IDs, JSON payload references) for UI polling and analytics.

### Steps
1. **Create a persistence model** (e.g. `backend/models/VaultDocumentJob.js`) with the following shape:
   - `userId`, `sessionId`, `fileId`, `originalName`, `collectionId`
   - `classification` ({ key, label, confidence })
   - `docupipe` ({ documentId, parseJobId, stdJobId, standardizationId })
   - `storage` ({ pdfKey, jsonKey, size, contentHash })
   - status flags: `state` (enum: `queued`, `needs_trim`, `awaiting_manual_json`, `processing`, `completed`, `failed`), `errors` array, `requiresManualFields` object
   - timestamps for auditing
2. **Refactor `/api/vault/upload`**:
   - After `handleUpload` resolves, fetch the first 150 KB of each PDF from R2, extract text using `extractPdfText` (existing helper) and classify via `classifyDocument`.
   - Map classification keys to schema IDs using environment variables (`DOCUPIPE_BANK_SCHEMA_ID`, `DOCUPIPE_PAYSLIP_SCHEMA_ID`, etc.). Reject files with unknown classes.
   - Determine trim requirement by invoking `trimBankStatement` only for statement-like classes; set `state = 'needs_trim'` if `originalPageCount > 5` (or whichever threshold already lives in trim service options).
   - Persist a `VaultDocumentJob` per file with `state = 'queued'` when no manual action blocks processing; otherwise store the blocking state and skip DocuPipe submission until resolved.
   - Return the session payload `{ sessionId, files: [{ fileId, originalName, state, classification }], rejected: [...] }`.
3. **Submit to DocuPipe when allowed**:
   - Implement a helper (e.g. `backend/src/services/vault/docupipeDispatcher.js`) that replicates `postDocument → waitForParseCompletion → startStandardize` from the JSON test bench.
   - Store DocuPipe IDs back onto the `VaultDocumentJob` document and set `state = 'processing'`.
   - Poll parse completion synchronously within the request and use async job (e.g. background worker/cron using `setImmediate` or queue) to poll `stdJobId` until completion. On completion:
     - Fetch JSON via `getStandardization`, persist to R2 using the same naming convention as current vault processing (`backend/src/routes/vaultProcessing.routes.js`), and update Mongo `DocumentInsight` records to keep dashboards functioning.
4. **Expose status endpoints**:
   - Replace `/api/vault/files/:fileId/status` implementation to read from `VaultDocumentJob` instead of `UserDocumentJob`.
   - Add endpoints to resume processing (`POST /api/vault/files/:fileId/process`), submit trim results, and patch manual JSON fields (`POST /api/vault/files/:fileId/manual-json`). Each endpoint should transition state and (re)dispatch DocuPipe when ready.
5. **Deactivate legacy worker path**:
   - Remove calls to `registerUpload` and update any cron/jobs/tests referencing `UserDocumentJob` for new uploads. Keep compatibility for historical jobs by gating the worker behind a feature flag if needed.

## 2. Vault UI: human-in-the-loop workflow

### Objectives
- Surface classification results and new manual checkpoints (trim review, missing JSON fields) with a traffic-light UX.
- Reuse existing modals/forms from the JSON test bench for user input.

### Steps
1. **Extend state model** in `frontend/js/vault.js`:
   - Update `LIGHT_STATUS_MAP` (or equivalent) to include `needs_trim` and `awaiting_manual_json` mapped to a red indicator.
   - Display the detected classification label and DocuPipe schema next to each file tile/card.
   - Render a `Manual completion` button when state is either `needs_trim` or `awaiting_manual_json`.
2. **Wire manual trim flow**:
   - On `Manual completion` click for trim-blocked files, open the existing trim review modal (`openTrimReview`). Submit the kept pages to the backend endpoint introduced above. After success, refresh the file list and resume DocuPipe processing.
3. **Wire manual JSON flow**:
   - Import / reuse the missing-field editor from `frontend/js/json-test.js` (the `missingPeriodEditor` pattern). On submission, send the filled values to `/api/vault/files/:fileId/manual-json`, which stores them in `requiresManualFields` and triggers DocuPipe with the merged payload.
4. **Enhance polling logic**:
   - Ensure the session refresh interval fetches updated states from the new endpoint and keeps the UI in sync, including switching amber/green/red lights as the backend updates `state`.
   - Show inline warnings (tooltip or callout) for blocked items, including reason text returned by the backend.
5. **Update templates** (`frontend/document-vault.html`) as needed to expose the classification label, schema name, and manual completion CTA while preserving accessibility (`aria-label` on buttons, descriptive text for status indicators).

## 3. Analytics + storage parity

### Steps
1. **JSON storage**: Save standardisation JSON to R2 using the same policy defined in `backend/src/routes/vaultProcessing.routes.js`, retaining collection/session naming.
2. **Mongo documents**: Populate `DocumentInsight` with the metadata currently produced by the worker (`services/worker/src/documentJobLoop.ts`). Ensure the ingestion path writes metrics, transactions, and derived fields for dashboards.
3. **Audit logging**: Append lifecycle entries (uploaded → classified → processing → completed) to `VaultDocumentJob` so admins can trace manual interventions.

---

### Deliverables Checklist
- [ ] New `VaultDocumentJob` model with migrations/tests.
- [ ] Updated `vault.js` routes covering upload, status, manual trim, manual JSON, resume processing.
- [ ] Shared DocuPipe dispatcher utility with retry/backoff.
- [ ] UI updates with manual completion workflows wired to backend.
- [ ] Documentation updates covering the new async flow and operational notes (feature flags, environment variables).

Following these steps will transform the Document Vault into a DocuPipe-driven ingestion experience with built-in human-in-the-loop safeguards, closely mirroring the JSON test bench behaviour while keeping storage and analytics outputs consistent.
