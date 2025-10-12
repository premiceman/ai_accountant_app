# Docupipe Integration Guide

This guide explains how to configure the AI Accountant platform to hand off payslip and statement parsing to Docupipe immediately after files are uploaded to the Document Vault.

## 1. Provision Docupipe access

1. **Create a Docupipe account** with API access enabled.
2. **Generate an API key** that has permission to upload documents and retrieve processed JSON payloads.
3. **Identify the endpoint** for your deployment. The worker defaults to `https://api.docupipe.com/v1` but you can point it at a private region if required.

## 2. Configure environment variables

Set the following variables for the parse worker container or process:

```
DOCUPIPE_API_KEY=<docupipe-api-key>
DOCUPIPE_API_BASE=https://api.docupipe.com/v1   # optional override
DOCUPIPE_POLL_INTERVAL_MS=2500                 # optional override (milliseconds)
DOCUPIPE_POLL_TIMEOUT_MS=300000                # optional override (milliseconds)
```

The backend does not need direct credentials; all communication happens through the parsing worker.

## 3. How the workflow operates

1. **Upload:** Users drop PDFs or ZIP files into the Document Vault. ZIPs are expanded and each PDF is validated against the selected catalogue entry.
2. **Queue:** Each stored document is enqueued to Redis with its storage path and original filename. The UI shows the first green light once the upload completes.
3. **Docupipe hand-off:** The parsing worker fetches the file from object storage, uploads it to Docupipe, and polls the document status until the JSON payload is ready.
4. **Persist JSON:** The worker posts the Docupipe response back to `/api/parse-result`. The backend stores the raw JSON on the `DocumentInsight` record and marks the second green light.
5. **Dashboards:** Downstream analytics and dashboards consume the stored Docupipe JSON to populate metrics and tables.

## 4. Testing checklist

- Upload representative payslips and bank statements and confirm the processing light turns green only after Docupipe returns JSON.
- Watch the parsing worker logs for lines starting with `[parse-worker]` to monitor upload latency and Docupipe polling duration.
- Inspect the `documentinsights` collection in MongoDB – `metadata.provider` should read `docupipe` and `metadata.docupipe.json` should contain the raw payload.
- Hit `/api/vault/files/<fileId>/status` to confirm the status endpoint reports `processing: green` once Docupipe completes.

## 5. Operational notes

- Polling timeout defaults to five minutes. Tune `DOCUPIPE_POLL_TIMEOUT_MS` if your Docupipe workspace requires more time.
- The worker stores the base64 upload in-flight only; no Docupipe credentials are persisted in the database.
- If Docupipe reports a failure, the parsing worker retries up to three times before marking the job as failed.
- Use the worker health endpoint (`/health`) to monitor Redis connectivity and job throughput.
