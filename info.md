# Entry Pass Generator (ICG) — Application Information

This document summarizes how the **Entry Pass Generator** application stores data, handles security and privacy, is hosted (including Render), supports export, and presents its user interface. It is derived from the current codebase (`server.js`, `public/` assets).

---

## 1. How data is stored

### Primary database (MongoDB)

- Employee records are stored in **MongoDB** (typically **MongoDB Atlas**), connected via the `MONGO_URI` environment variable.
- The Mongoose model `Employee` persists fields such as full name, Aadhar number, date of birth, age, gender, blood group, contractor, labor camp, designation, contact, dates (DOI, validity, issue), **site**, **operator**, **photo URL**, and `createdAt`.
- **Uniqueness:** Sparse unique indexes on `aadhar` and `contact` reduce duplicate registrations at the database level.
- **Master lists** (sites, contractors, roles) live in a separate `MasterData` collection, keyed by `type`, each holding an array of strings.

### Media (photos)

- When a submission includes a base64 image (`data:image/...`), the server uploads it to **Cloudinary** (folder `id_cards`, unique `public_id`). The **HTTPS URL** returned by Cloudinary is what gets stored in `photoPath` on the employee document.
- If Cloudinary upload fails, the record may still be saved **without** a cloud photo (a warning is returned to the client).

### Client-side persistence (browser)

- **Operator session:** After login, operator name, site, and bearer **token** are stored in `localStorage` under `ep_operator` (restored on load after `/api/auth/verify`).
- **Batch queue:** Pending batch entries use `localStorage` (`ep_batch`) with **JPEG previews** only; full-resolution print PNGs stay in memory (documented in code to avoid oversized storage).
- **Admin panel:** Admin bearer token and tab preference use `sessionStorage` (`ep_admin_token`, `ep_admin_tab`, `ep_admin`). Record list **default date window** preference uses `localStorage` (`ep_retention`).

### Sessions (server memory)

- Login sessions are **not** stored in MongoDB. Bearer tokens and metadata (`role`, `username`, `site`, `expiresAt`) are kept in an in-memory `Map`. They are cleared on expiry (hourly sweep) or when the process restarts.

---

## 2. Data privacy and security (current design)

### Transport and HTTP hardening

- **Helmet** is applied (with default CSP disabled and a **custom Content-Security-Policy** header set separately to allow TensorFlow.js from jsDelivr, inline styles, fonts, and `connect-src` to HTTPS/self).
- **CORS** is restricted: allowed origins include entries from `ALLOWED_ORIGINS`, localhost for development, and hostnames ending in `.onrender.com`. Other origins are rejected.
- **`trust proxy`** is set for correct client IP behavior behind a reverse proxy (e.g. Render).
- **Rate limiting** on `/api/*`: 300 requests per 15 minutes per IP (helps mitigate abuse and scraping).
- **JSON body size** capped at **5 MB** (`body-parser`).

### Authentication and authorization

- **Operators** authenticate with `POST /api/auth/operator` and receive a random hex token. Protected routes expect `Authorization: Bearer <token>`.
- **Admins** use `POST /api/auth/admin`; credentials come from `ADMIN_USER` / `ADMIN_PASS` (with code defaults if unset—**production should always set these via environment variables**).
- **Session lifetimes:** operator sessions ~24 hours; admin ~8 hours (server-side).
- **Role checks:** Destructive and analytics endpoints use `requireAdmin` (e.g. delete employee, stats, updating master lists). Saving employees and listing employees use `requireAuth` (any valid session).

### Input validation

- `POST /api/save-employee` validates name pattern/length, 12-digit Aadhar, Indian mobile pattern, and allowed gender values before persisting.

### Secrets and configuration

- Required secrets for startup: `MONGO_URI`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.
- Local `.env` is loaded in non-production when the file exists; **`.env` is listed in `.gitignore`** so it is not committed.

### Logging

- Server logs include operational messages; delete operations write an **audit-style** line to the console (ID, name, Aadhar, admin user, timestamp). Log sinks on Render should be treated as sensitive if they capture PII.

### Privacy-related caveats (know your deployment)

- Operator passwords are **derived in application code** from usernames/sites (`getOperatorPassword`). For stronger privacy and security, credentials should be **migrated to environment variables or a proper user store** and rotated regularly.
- **Master data** `GET /api/sites`, `/api/contractors`, `/api/roles` are **unauthenticated** (intended for dropdown population; consider whether that is acceptable for your threat model).
- **Duplicate check** returns limited fields of an existing match (including identifiers) to authenticated users—needed for UX but still sensitive.

---

## 3. How data leakage is prevented (and residual risks)

### Measures in place

- **HTTPS** is assumed in production (Render terminates TLS; app listens on HTTP internally).
- **CORS** reduces cross-site API calls from arbitrary websites (browsers enforce this for scripted requests).
- **Rate limiting** reduces high-volume enumeration from a single IP.
- **XSS mitigation in admin UI:** dynamic table content uses an `esc()` helper so text is inserted safely; operator UI uses `esc()` where user-controlled strings are injected into HTML.
- **Pagination** on employee listing (`page`, `limit`, max 500 per request) limits unbounded dumps in one response.
- **No secrets in repo** for DB/Cloudinary (via `.env` ignore); operators should rely on Render **Environment** for production values.

### Residual risks / hardening opportunities

- **`GET /api/employees`** accepts an optional `site` query parameter but **does not enforce** that an **operator** may only read their own site’s rows. The operator UI passes `site=<operator.site>`, but anyone with a valid operator token could call the API with another `site` or without `site` and receive broader results. **Recommended fix:** for `role === 'operator'`, force `filter.site = req.userSession.site` (and ignore client-supplied site), while admins keep full filter access.
- **In-memory sessions:** horizontal scaling (multiple instances) would **not** share sessions unless you add sticky sessions or external session storage.
- **Duplicate-check** responses expose some PII when a duplicate exists—limit fields if policy requires minimal disclosure.
- **Client storage:** tokens in `localStorage` are visible to any script on the same origin; keep dependencies trusted and CSP strict where possible.

---

## 4. Hosting (Render) and upgrades

### How it is hosted today

- The app is a **single Node.js process** (`npm start` → `node server.js`), serving:
  - **REST API** under `/api/...`
  - **Static files** from `public/` (including `index.html` and `admin.html`)
- It binds to **`0.0.0.0`** and uses **`process.env.PORT`** (Render sets `PORT`; locally the code defaults to `10000` in `server.js`).
- A **`/health`** endpoint returns `OK` for load checks.
- **`NODE_ENV=production`** disables loading a local `.env` file; configuration should come from the host’s environment.

There is **no `render.yaml` Blueprint** in this repository snapshot; deployment is typically a **Render Web Service** connected to the Git repo, with environment variables set in the Render Dashboard.

### How to upgrade or scale on Render

1. **Deploy new versions:** Push to the linked branch; Render builds and deploys, or trigger **Manual Deploy** from the service’s **Deploys** tab.
2. **Change instance size / plan:** In the Web Service **Settings**, adjust **Instance Type** (CPU/RAM) for heavier traffic or larger Node heap needs.
3. **Environment variables:** Update `MONGO_URI`, Cloudinary keys, `ADMIN_USER` / `ADMIN_PASS`, optional `ALLOWED_ORIGINS`, and `NODE_ENV` in **Environment**; redeploy or use **Save and deploy** as appropriate.
4. **Zero-downtime expectations:** Brief restarts on deploy will **clear in-memory sessions**; users must re-login.
5. **Optional Blueprint:** Add a `render.yaml` later to codify the service, build command (`npm install`), start command (`npm start`), and env var names for repeatable environments.
6. **Database and media:** Upgrading the **web service** does not migrate data; MongoDB Atlas and Cloudinary retain data independently—ensure connection strings and keys remain valid after any credential rotation.

---

## 5. How data can be exported

### Operator app (`public/script.js`)

- **Single pass:** **Download** as a PNG (`ENTRY_PASS_<SITE>_<NAME>.png` from the ID card canvas); **Print** via a popup print flow.
- **Batch:** Items can be downloaded as PNGs and printed in batch; batch previews persist in `localStorage`, not the full print PNGs.
- **Site records modal (“View My Records”):** Loads `/api/employees?site=...` and can **export to CSV** (`SiteRecords_<site>_<date>.csv`) from the visible table (UTF-8 BOM for Excel compatibility).

### Admin panel (`public/admin.js`)

- **Records tab:** Table built from `/api/employees` (with optional date filters and client-side retention preference). **Export to CSV** (`EntryPass_Records_<date>.csv`) skips the photo column and delete button column; includes text fields shown in the table.

### Not implemented in code (organizational options)

- **Server-side bulk export** (e.g. signed URL, scheduled dump) is not present; exports are **browser-driven** from already-fetched data.
- **MongoDB Atlas** and **Cloudinary** consoles provide their own backup/export mechanisms outside this app.

---

## 6. UI/UX design

### Visual language

- **Typography:** [Inter](https://fonts.google.com/specimen/Inter) from Google Fonts (weights 400–800).
- **Color system (CSS variables):** Deep navy primary (`#1a3c6e`), gold accent (`#c8a45a`), light slate background (`#f8fafc` operator / `#f1f5f9` admin), semantic **success** (`#10b981`) and **danger** (`#ef4444`).
- **Layout:** Card-based, rounded corners (`--radius: 12px`), subtle borders and shadows; login uses a full-screen gradient overlay and centered card with accent bottom border.

### Operator experience (`index.html` + `style.css` + `script.js`)

- **Flow:** Login overlay → main app with **sticky header** (logo, title, operator context, logout, “View My Records”).
- **Multi-step form:** Stepper for **Personal → Employment → Photo** inside a horizontal **carousel** to reduce cognitive load.
- **Photo step:** Webcam integration, optional portrait effects (TensorFlow.js / body segmentation from CDN), capture/retake, live feedback.
- **Preview:** CR80-style card preview, download/print/add-to-batch actions, toasts for feedback.
- **Accessibility touches:** `noscript` message; some `aria-selected` usage in admin tabs.

### Admin experience (`admin.html` + `admin.css` + `admin.js`)

- **Tabbed shell:** Dashboard, Records, Manage (CRUD for lists), Settings.
- **Dashboard:** Animated counters, **bar charts** for counts by site and contractor (CSS gradients, tooltips).
- **Records:** Sorting, date filters, retention presets (stored locally), delete with confirmation modal.
- **Modals:** Custom alert/confirm dialogs; Escape key closes them.
- **Shared patterns** with operator app: overlay login, password visibility toggle, `esc()` for safe HTML.

---

## Document maintenance

When you change storage, auth, or APIs, update this file so operations and compliance reviews stay aligned with the implementation. For Render-specific runbooks, link your internal service URL and MongoDB/Cloudinary project names here if helpful.
