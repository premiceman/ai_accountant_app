# PDF Parsing to JSON Walkthrough

This document captures the end-to-end flow that was described in conversation: how an uploaded PDF is parsed and ultimately converted into the JSON structures consumed by the rest of the platform.

## 1. Intake & Storage
1. **Upload acceptance**: The web app only accepts PDF files. Other formats are rejected with a friendly error.
2. **Content hashing**: Once a PDF is received, the backend calculates a SHA-256 hash (`contentHash`). This is later used to enforce idempotency.
3. **Durable storage**: The raw PDF is persisted to Cloudflare R2 under a user-scoped key, retaining the hash and metadata.
4. **Queueing for processing**: A background job (Render worker) is enqueued with the document reference, `contentHash`, and current parser version.

## 2. Pre-Processing
1. **PDF validation**: The worker opens the file and ensures it is a valid PDF, short-circuiting if the file is corrupt or encrypted.
2. **Text extraction**: The worker uses a heuristic-first parser (e.g., `pdfplumber`/`PyPDF`) to extract structured text blocks. If the PDF has poor text quality, an OCR fallback can be triggered.
3. **Page segmentation**: Each page is segmented into lines, tables, and key-value pairs. The parser tags each segment with positional metadata (page number, bounding boxes) to support downstream heuristics.

## 3. Document Classification
1. **Template identification**: Using keywords, layout heuristics, and optional ML classifiers, the system determines whether the document is a payslip, bank statement, or "other".
2. **Schema selection**: Based on the classification, it selects the appropriate extraction schema (`payslip`, `current_account_statement`, etc.).

## 4. Field Extraction
### 4.1 Heuristic Layer
1. **Regex & layout rules**: Domain-specific regex patterns and positional rules identify gross pay, tax, NI, transaction rows, and other figures.
2. **Normalization**: Values are normalised (currency parsing, minus handling, thousands separators, date formats) and converted to **minor units** integers.
3. **Record linking**: Transactions are associated with accounts; payslip deductions are grouped under canonical categories.

### 4.2 LLM/OCR Fallbacks
1. **Confidence check**: If heuristics do not reach a confidence threshold, a prompt is assembled for an LLM to suggest field mappings.
2. **Consensus merge**: Heuristic and LLM results are merged, preferring deterministic heuristics and only filling gaps from the LLM with provenance notes.

## 5. JSON Structuring
1. **DocumentInsight envelope**: Extracted fields are populated into the `DocumentInsightV1` structure, including `parserVersion`, `promptVersion`, and confidence scores.
2. **Transaction and metrics arrays**: For statements, each transaction becomes a `TransactionV1` entry; for payslips, totals populate `PayslipMetricsV1`.
3. **Version stamping**: The document is stamped with `version: 'v1'` and the processing timestamp.

## 6. Persistence & Aggregation
1. **MongoDB persistence**: The structured JSON is saved into MongoDB collections keyed by user and document ID.
2. **Aggregations**: Background jobs update monthly/quarterly aggregates (income, spend, tax) in the `InsightsEnvelopeV1` rollup documents.
3. **Idempotency enforcement**: If a PDF with the same `contentHash` and parser version is re-uploaded, processing is skipped to avoid duplicates.

## 7. Exposure to Frontend
1. **API responses**: The JSON documents back the REST/GraphQL endpoints the frontend uses to render dashboards.
2. **Status surfaces**: Processing state is exposed so the UI can show "processing", "ready", or "failed" messages.

---

This walkthrough mirrors the high-level explanation previously shared in conversation and is now captured in the repository for future reference.
