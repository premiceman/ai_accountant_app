# DocuPipe On-Call Runbook

## Structured skip logs

The DocuPipe service now emits structured warnings whenever a job ID is skipped during polling.

```
[docupipe] DocuPipe job skipped { jobId: "job_123", reason: "not_found", jobType: "standardization", candidate: { classKey: "invoice", standardizationJobId: "std_job_456", standardizationId: "std_789", classificationJobId: "cls_321", source: "classifyStandardizeStep" }, elapsedMs: 4500, intervalMs: 1500 }
```

Key fields:

- `jobId`: The DocuPipe job identifier being polled.
- `reason`: `not_found` for HTTP 404 responses during polling, or `timeout` once the poller exhausts its timeout window.
- `jobType`: High-level phase (`upload`, `classification`, `standardization`) to pinpoint which polling loop is affected.
- `candidate`: Standardization candidate metadata, when available. Use the IDs here to reconcile with DocuPipe dashboards or internal records.
- `elapsedMs`: How long the poller has been waiting on the job.
- `intervalMs`: Current retry delay between poll attempts.

Logs are automatically throttled for the same `{jobId, reason}` pair to avoid noise during transient outages. A timeout log indicates that the poller has stopped retrying and surfaced an error upstream.

## Common responses

- **404 but no timeout**: The job likely has not been materialized yet. Investigate upstream delays; retries will continue automatically.
- **Timeout**: The job never surfaced or failed to update status before the deadline. Requeue the document or escalate to the DocuPipe vendor.
