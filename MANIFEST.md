<!-- // NOTE: Hotfix — TS types for shared flags + FE v1 flip + staged loader + prefer-v1 legacy; aligns with Phase-1/2/3 specs. Additive, non-breaking. -->
# AI Accountant Application - Feature Manifest

## 🔐 Authentication & User Management
- **Feature**: User Signup
  - **File**: backend/routes/auth.js
  - **Description**: Registers new users with hashed passwords using bcryptjs and stores them in MongoDB.

- **Feature**: User Login
  - **File**: backend/routes/auth.js
  - **Description**: Authenticates users by validating credentials and issues JWT tokens for session management.

## 📁 Document Uploads
- **Feature**: File Upload via UI
  - **File**: frontend/home.html
  - **Description**: Allows users to upload files with real-time feedback and timestamp display. Warns if upload is outdated.

- **Feature**: Backend File Upload Endpoint
  - **File**: backend/routes/upload.js
  - **Description**: Handles `multipart/form-data` POST requests. Saves files to `uploads/` and updates user metadata.

## 🧠 AI-Powered Report Generation
- **Feature**: Financial Report Generation with OpenAI
  - **File**: backend/ai/reportGenerator.js
  - **Description**: Calls OpenAI's API with user financial data and returns a natural language summary.

- **Feature**: User Report Endpoint
  - **File**: backend/routes/user.js
  - **Description**: Accepts user financial data via POST, generates insights using GPT, and returns the response.

## 🛠️ Backend Configuration
- **Feature**: Express App Configuration
  - **File**: backend/index.js
  - **Description**: Bootstraps the server, connects to MongoDB using Mongoose, and mounts all routes.

## 🧾 Models
- **Feature**: User Model
  - **File**: backend/models/User.js
  - **Description**: Defines schema for users including name, email, password, and uploaded file data.

## 🌍 Environment Variables
- **File**: `.env` (create from `.env.example`)
- **Keys**: populate using secure values for your environment. See `.env.example` for placeholders and flag defaults.
- **Required additions for schematics parsing**:
  - `REDIS_URL` — connection string for the shared Redis instance that backs `parse:jobs` and `parse:session:*` bookkeeping.
  - `PARSE_WORKER_TOKEN` — shared bearer token that authorises the parsing worker when it posts `/api/parse-result`.

## 📂 Directory Structure
- backend/
  - index.js
  - routes/
    - auth.js
    - upload.js
    - user.js
  - ai/
    - reportGenerator.js
  - models/
    - User.js
  - .env
- frontend/
  - index.html
  - login.html
  - signup.html
  - home.html
- uploads/
  - (user-uploaded files)

---

## ✅ Last Verified: v1.0 Complete Restore
This manifest tracks the current state of all working features, file locations, and configuration in your application.

## Profile Management (Implemented)

- **Frontend**
  - `frontend/profile.html`: Profile summary (email, member since) + edit form (first name, last name, email, phone, address).
  - `frontend/js/profile.js`: Fetches `GET /api/user/me` and updates via `PUT /api/user/me`. Uses JWT from storage (supports `token`/`jwt`/`authToken`). Forces re-login on email change.

- **API**
  - `GET /api/user/me` (auth required): returns safe user fields (no password).
  - `PUT /api/user/me` (auth required): allowlist updates; trims/validates; enforces unique email; returns `{ user, forceReauth }`.

- **Model**
  - `backend/models/User.js`: optional `phone` and `address` fields added; non-breaking.

- **Security**
  - Endpoints require `Authorization: Bearer <token>`.
  - Server never returns password; input trimmed; timestamps maintained.

  # AI Accountant App — Project Manifest (v0.1)  
**Date:** 28 Aug 2025 • **Branch:** `test` • **Owner:** Prem

**Stack:** Node.js + Express + MongoDB (Mongoose), HTML/CSS/Vanilla JS, JWT auth, GridFS (documents).  
**Status:** ✅ Auth (signup/login) • ✅ Route-guarded pages • ✅ Documents Vault (upload/list/delete, progress) • ✅ API base centralised • ⏳ Dashboard compute (stub UI in place)

---

## 1) Environments & Config

**backend/.env (example)**


**Frontend API base**: `frontend/js/config.js`
- Dev: pages on `:3000` or `:8080` both call the API on `http://localhost:3000`.
- Prod (same-origin): uses `location.origin`.
- Override without rebuild:
  ```html
  <script>window.__API_BASE='https://api.example.com';</script>

ai_accountant_app/
├─ backend/
│  ├─ index.js
│  ├─ package.json
│  ├─ routes/
│  │  ├─ auth.js                 # POST /api/auth/login|signup
│  │  └─ user.js                 # GET/PUT /api/user/me
│  ├─ middleware/
│  │  └─ auth.js                 # JWT guard (req.user)
│  ├─ models/
│  │  └─ User.js                 # Mongoose User
│  └─ src/
│     ├─ routes/
│     │  ├─ summary.routes.js    # GET /api/summary/current-year (stub)
│     │  └─ documents.routes.js  # POST/GET/DELETE /api/docs
│     ├─ services/
│     │  └─ documents/
│     │     └─ storage.service.js # GridFS save/list/delete
│     └─ config/
│        └─ tax/
│           └─ 2025-26.json      # (planned rules-as-data)
│
├─ frontend/
│  ├─ components/
│  │  └─ navbar.html
│  ├─ home.html                  # Dashboard shell (waterfall/EMTR placeholders)
│  ├─ documents.html             # Docs & Integrations (progress, modal, list)
│  ├─ login.html
│  ├─ signup.html
│  ├─ profile.html
│  └─ js/
│     ├─ config.js               # window.API (central base + fetch helper)
│     ├─ auth.js                 # Auth helpers + Auth.enforce(), requireAuth()
│     ├─ login.js                # POST /api/auth/login
│     ├─ signup.js               # POST /api/auth/signup
│     ├─ dashboard.js            # Renders stub charts via /api/summary/current-year
│     └─ documents.js            # Table + progress + per-type file modal + upload/delete
│
├─ docs/
│  ├─ manifest.md                # (this file)
│  └─ architecture-notes-v0.1.md
└─ .gitignore


{
  "year": "2025/26",
  "currency": "GBP",
  "waterfall": [
    {"label":"Gross Income","amount":0},
    {"label":"Income Tax","amount":0},
    {"label":"National Insurance","amount":0},
    {"label":"Student Loan","amount":0},
    {"label":"Pension","amount":0},
    {"label":"Net Pay","amount":0}
  ],
  "emtr": [{"income":0,"rate":0.0},{"income":10000,"rate":0.2}],
  "gauges": {
    "personalAllowance":{"used":0,"total":12570},
    "dividendAllowance":{"used":0,"total":500},
    "cgtAllowance":{"used":0,"total":3000},
    "pensionAnnual":{"used":0,"total":60000},
    "isa":{"used":0,"total":20000}
  },
  "events": []
}



**Key decisions**
- **API base** centralised in `config.js` → same code works on `3000`, `8080`, or custom domain.  
- **GridFS** chosen for simplicity & locality; service abstraction allows S3 later.  
- **Stubbed summary** endpoint returns a stable contract so the UI can ship now; compute is swappable.

---

## 3) Modules & Boundaries

**Documents storage service (`src/services/documents/storage.service.js`)**
- Public API: `saveBufferToGridFS(buffer, filename, metadata)`, `listFiles(userId)`, `deleteFileById(id, userId)`.
- Implementation detail: GridFS + ownership checks; easy to replace with S3/MinIO using the same interface.

**Summary compute (planned)**
- `src/config/tax/2025-26.json` — bands, thresholds, allowances.
- `src/services/tax/compute.service.js` — pure functions returning `{ waterfall, emtr, gauges }`.
- `src/routes/summary.routes.js` orchestrates: load profile → compute → respond.

**Auth**
- JWT bearer stored client-side (currently localStorage).
- `middleware/auth.js` attaches `req.user` (id, etc.) and protects routes.

---

## 4) Frontend Patterns

- **Guard early**: `Auth.enforce()` at page load; `Auth.requireAuth()` fetches user to personalise UI.
- **Single API surface**: `window.API.url(path)`/`window.API.fetch(path, opts)` eliminate hard-coded hosts/ports.
- **Progress-first UX**: The documents table renders a static catalogue **before** network, then overlays server state.

---

## 5) Security Considerations (design)

- **Per-user isolation**: All `docs` queries include `metadata.userId`; delete checks both `_id` and `userId`.
- **Upload limits**: Multer `memoryStorage` + `MAX_UPLOAD_MB`; friendly 413 responses.
- **Future**: 
  - HttpOnly cookie-based tokens + CSRF for state changes.
  - Zod/Joi validation at route edges.
  - Helmet + strict CSP.
  - AV scanning for uploads and safe download headers.

---

## 6) Performance Considerations

- GridFS listing sorted by `uploadDate desc`; add indexes (`userId,type,uploadDate`) for scale.
- Static assets served by Express; can front with CDN/reverse proxy if needed.
- Dashboard compute designed as **pure functions** → easily cache per user-year.
- Optional gzip (`compression`) and smart cache headers for static.

---

## 7) Alternatives Considered

- **S3/MinIO** for documents: postponed in favour of GridFS simplicity during prototyping; service kept swappable.
- **React** SPA: postponed; current vanilla JS meets scope with minimal complexity.
- **Server-side rendered templates**: chosen not to, to keep frontend independent/static-friendly.

---

## 8) Testing Strategy (planned)

- **Unit (Jest):** tax compute and CGT pooling (deterministic).
- **Integration (supertest):** auth, docs upload/delete (with in-memory Mongo or test DB).
- **E2E (Playwright):** signup → login → upload → see progress → delete → logout.

---

## 9) Deployment Sketch

- **Single origin (recommended):** `app.yourdomain.com` serves frontend; reverse-proxy `/api` to Node.
- **Env injection:** `.env` in container/host; never commit secrets.
- **TLS termination** at proxy; enable HSTS.
- **Scaling:** stateless Node; sticky sessions not required; Mongo/Atlas for DB.

---

## 10) Next Steps (engineering backlog)

1) **Dashboard compute**
   - Implement `config/tax/2025-26.json` and `services/tax/compute.service.js`.
   - Add `GET/PUT /api/income/profile`; wire summary to profile.
2) **Vault polish**
   - `GET /api/docs/:id/download` (stream GridFS) + safe `Content-Disposition`.
   - File-type validation; optional AV scan; thumbnails/previews.
3) **Security hardening**
   - Helmet, rate limiting, strict CORS.
   - Input validation and error contract.
   - Optional cookie-based auth with refresh tokens.
4) **Equity/CGT Core**
   - Models + `equity/cgt.service.js`; pool/disposal endpoints & tests.
5) **CI/CD**
   - GitHub Actions (lint/test), coverage thresholds for compute services.
