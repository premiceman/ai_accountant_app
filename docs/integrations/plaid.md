# Plaid Integration

This service wraps Plaid Link so we can run the product locally in sandbox mode while still supporting live mode in production. The integration is guarded by a configuration helper (`backend/utils/plaidConfig.js`) that centralises our environment flags and product scopes.

## Configuration overview

| Variable | Purpose |
| --- | --- |
| `PLAID_ENV` | Target Plaid environment (`sandbox` by default). |
| `PLAID_ENV_OVERRIDE` | Set to `live`, `true`, or `allow` to bypass the sandbox guard and create real link tokens. Leave unset in local/dev so requests short-circuit. |
| `PLAID_PRODUCTS` / `PLAID_TRANSACTIONS_PRODUCTS` | Optional comma lists of Plaid product scopes. Default is `transactions`. |
| `PLAID_COUNTRY_CODES` | Optional comma list of supported country codes (defaults to `GB,US`). |
| `PLAID_SYNC_FRESHNESS_MS` | Maximum age for account/transaction data before we refresh (defaults to 5 minutes). |
| `PLAID_SYNC_WORKER_INTERVAL_MS` | Interval for the background sync worker (defaults to 24 hours). |
| `DISABLE_PLAID_SYNC_WORKER` | Set to disable the worker entirely. |

The helper also exposes `isSandbox`. When `isSandbox` is `true`:

* `/api/plaid/link/launch` returns the seeded sandbox items instead of creating a live link token.
* `/api/plaid/link/exchange` creates/updates local `PlaidItem` documents with the sandbox data and immediately syncs transactions.
* The sync worker pulls seed data from `data/accounts.json` and `data/transactions.json` instead of calling Plaid.

Live mode only executes when both `PLAID_ENV` points at the live environment and `PLAID_ENV_OVERRIDE` is set to an allow-list value. This prevents accidental token creation during QA runs.

## Sandbox workflow for QA

1. Ensure your `.env` has `PLAID_ENV=sandbox` and **do not** set `PLAID_ENV_OVERRIDE`.
2. (Optional) Create or locate a QA user in MongoDB.
3. Seed the sandbox fixtures for that user:

   ```bash
   node scripts/plaidSandboxFixtures.js --user qa@example.com
   ```

   *The script wipes existing Plaid items for the user, loads accounts from `data/accounts.json`, and populates transactions from `data/transactions.json` so the dashboard has data immediately.*
4. Hit `/api/plaid/items` (through the UI or API) to load the seeded item. The backend ensures both balances and transactions are refreshed before responding.

You can reseed at any time by rerunning the script. Pass `--dataset <name>` if we add alternative fixture sets in the future.

## Switching to live mode

1. Configure live credentials (`PLAID_CLIENT_ID`, `PLAID_SECRET`, etc.) and set `PLAID_ENV=production` (or the desired non-sandbox environment).
2. Explicitly opt-in by setting `PLAID_ENV_OVERRIDE=live` (any of `live`, `true`, `1`, or `allow` works). Without this override the backend will return HTTP `412` to avoid accidental live connections.
3. Restart the backend. Link token creation and public-token exchange will now call Plaid.

When you toggle back to sandbox simply remove the override (or reset `PLAID_ENV=sandbox`) and reseed fixtures if needed.

## Transactions sync worker

* The worker (`backend/services/plaidSyncWorker.js`) starts automatically when the backend boots. It runs once on startup and then on the schedule defined by `PLAID_SYNC_WORKER_INTERVAL_MS`.
* For sandbox items the worker hydrates data from the JSON fixtures. For live items it uses `transactionsSync` (or `transactionsGet` as a fallback) and stores results in the `Transaction` collection.
* Every Plaid API route that returns items calls the worker helper to guarantee the data is fresher than `PLAID_SYNC_FRESHNESS_MS`.

To run the sync manually:

```bash
node -e "require('./backend/services/plaidSyncWorker').runPlaidSyncOnce({ force: true })"
```

Use `DISABLE_PLAID_SYNC_WORKER=1` if you need to disable the background job during certain test scenarios.
