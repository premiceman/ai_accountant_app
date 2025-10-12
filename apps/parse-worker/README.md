# Parse Worker

Background worker that consumes document parsing jobs from Redis and writes structured results back to Redis so the web app can read them.

## Usage

- **Service type:** Background worker
- **Node runtime:** Node.js 22 (Render default)
- **Root directory:** `apps/parse-worker`
- **Build command:** `npm ci && npm run build` (also works with `npm install && npm run build`)
- **Start command:** `npm start`

## Environment

- `REDIS_URL`: Connection string for the Redis instance used to share jobs/results.

## Redis contract

Jobs are `LPUSH`ed onto `parse:jobs` with a JSON payload:

```json
{
  "docId": "uuid",
  "userId": "user-id",
  "storagePath": "https://storage/doc.pdf",
  "docType": "payslip",
  "userRulesVersion": "optional-version-id",
  "dedupeKey": "optional-dedupe-token"
}
```

- The worker ensures idempotency by skipping jobs where `dedupeKey` was processed recently.
- Results are written to `parse:result:{docId}` with the structure:

```json
{
  "ok": true,
  "classification": { "docType": "payslip", "confidence": 0.8, "anchors": ["payDate"] },
  "fieldValues": {
    "grossPay": {
      "field": "grossPay",
      "source": "rule",
      "value": 1234.56,
      "positions": [
        {
          "lineIndex": 12,
          "charStart": 14,
          "charEnd": 23,
          "pageNumber": 1,
          "boxes": [
            { "page": 1, "left": 212.3, "top": 456.7, "width": 108.2, "height": 14.1 }
          ]
        }
      ]
    }
  },
  "insights": { "metrics": { "grossPay": 1234.56 } },
  "narrative": [],
  "metadata": {
    "payDate": "05/2024",
    "periodStart": "05/2024",
    "periodEnd": "05/2024",
    "extractionSource": "rules@v3",
    "employerName": "Employer Ltd",
    "personName": "Employee Name",
    "rulesVersion": "v3",
    "dateConfidence": 0.82,
    "fieldPositions": {
      "grossPay": [
        {
          "lineIndex": 12,
          "charStart": 14,
          "charEnd": 23,
          "pageNumber": 1
        }
      ]
    }
  },
  "text": "full text...",
  "storage": { "path": "https://storage/doc.pdf", "processedAt": "2024-05-28T12:00:00.000Z" },
  "metrics": { "latencyMs": 1200, "ruleLatencyMs": 150 },
  "softErrors": []
}
```

- `fieldValues` entries now include optional `positions` data to help render highlights. Each position references the line index,
  character range and, when available, PDF bounding boxes in page coordinates.
- The worker also echoes a flattened `metadata.fieldPositions` map for consumers that only need positional data without the
  full field payload.

- Errors are written to `parse:error:{docId}`.
- Listeners can subscribe to `parse:done` to be notified when a document finishes processing.

## Pure helpers

The worker exports two pure helpers that the web application can reuse:

- `extractText(buffer, docType)` → `ExtractedTextContent` – returns normalised text plus page geometry.
- `extractFields(extractedText, docType, userRules)` – runs rule-based extraction with heuristics + validation using the
  geometry metadata.
- `suggestAnchors(text)` – returns likely anchors for UI highlight mode.
