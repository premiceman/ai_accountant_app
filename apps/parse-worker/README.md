# Parse Worker

Background worker responsible for normalising document insights. Configure via environment variables:

- `MONGODB_URI`
- `REDIS_URL`
- `DOC_INSIGHTS_QUEUE` (default `doc-insights`)
- `BULLMQ_PREFIX` (default `ai_accountant`)
- `WORKER_CONCURRENCY` (default `5`)
- `NODE_ENV`

Use `npm run build` then `npm start` for production or `npm run dev` locally.
