# docs/architecture-notes-v0.1.md
## Context
- Backend: Node.js + Express + Mongoose (MongoDB).
- Frontend: Static HTML/CSS + vanilla JS + Bootstrap 5.
- Auth: JWT via `/api/auth/login` (already working).
- Goal: Extend with dashboard compute, income explorer, and document vault — additively.

## Folder shape (additive)
backend/
  src/
    config/           # rules as data
    services/         # pure(ish) compute + adapters
      tax/
      documents/
    models/           # new models (kept separate from existing)
    routes/           # new routers
    lib/              # helpers (future)
    controllers/      # optional later

## Key decisions
- **Rules as data**: annual tax rules in JSON; calculators read from it.
- **Separation**: Routes stay thin; services contain logic; models define persistence.
- **Upload store**: GridFS default (MongoDB); can swap to S3 later via a small adapter.
- **Auth**: All new endpoints are JWT-protected via your existing middleware.
- **Compatibility**: We do not change existing `backend/routes/*` auth/login.

## First endpoints
- `GET /api/summary/current-year`: outputs waterfall (gross→tax→NI→SL→pension→net), EMTR points (0–200k), allowance gauges, stub events.
- `GET/PUT /api/income/profile`: persist simple employment profile.
- `POST /api/income/what-if`: compute take-home & EMTR for a hypothetical salary.
- `POST /api/docs` (upload to GridFS), `GET /api/docs`, `GET /api/docs/expected`.

## Frontend pages
- `/income.html`: editable profile + “what-if” tile.
- `/documents.html`: upload widget + stale checklist.

## Next (follow-up commits)
- Equity/CGT core (`services/equity/cgt.service.js`, routes: pool + disposal calc).
- Scenario Lab (save/compare).
- Gifts & IHT (log + timeline).
- Calendar/tasks (seed UK deadlines).

