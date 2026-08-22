# MIRRA — Technical Build Specification (for AI Coding Agent)

**Purpose of this document:** This is a self-contained engineering spec for building the MIRRA MVP. Give this whole document to your coding agent as the primary reference. It defines scope, architecture, data models, API contracts, folder structure, and a phase-by-phase build order so the agent can implement without needing outside context.

**MVP Scope Decision:** Build **Feature A only** first (entry scan + in-aisle virtual try-on), using the **2D generative-photo compositing approach**, not full 3D cloth simulation. This is deliberately the cheapest, fastest path to a working, demoable pilot. Feature B (style discovery/store locator) is explicitly out of scope for this build — it depends on multi-retailer data that won't exist yet. Do not build Feature B components in this phase.

---

## 1. System Overview

MIRRA MVP has four user-facing surfaces and a backend platform:

1. **Entry Kiosk App** — captures a shopper's body scan, gets consent, issues a session linked to an RFID band.
2. **In-Aisle Display App** — reads the RFID band at a garment rack, fetches the shopper's session/body model, requests a rendered try-on image, displays it.
3. **Retailer Admin Dashboard** — lets store staff upload garment catalog (SKUs + photos), view sessions/analytics, manage consent/retention settings.
4. **Backend Platform** — API + services that tie it all together (session management, body modeling, rendering, catalog, consent ledger).

All four surfaces talk to one backend via a REST API. No component should call another component's database directly — everything goes through the API layer.

---

## 2. Non-Negotiable Design Constraints

The agent must follow these regardless of what's easiest to implement:

- **No facial geometry storage.** The body-capture pipeline must only ever produce/store a body-shape/silhouette representation (proportions, height, rough measurements). Never persist a face embedding or anything that could function as a "faceprint." If the CV model used produces facial landmarks internally, discard them before storage — never write them to the database.
- **Consent-first.** No body-scan data may be written to persistent storage until an explicit `consent: true` flag has been recorded for that session. Until then, data lives only in-memory / transient cache with a short TTL (max 10 minutes).
- **Session TTL by default.** Every session (and its body model) auto-expires and is deleted at end-of-day unless the shopper explicitly opted into "save my profile for next visit" (a separate, clearly-labeled consent flag, `save_profile: true`).
- **RFID band is just a pointer.** The RFID tag ID must never itself be treated as a permanent identity. It only maps to a `session_id` for the duration of one visit, then is released.
- **All body model + garment data must be namespaced per retailer (`tenant_id`)** — build multi-tenant from day one even though the pilot only has one retailer, so onboarding retailer #2 later doesn't require a data model rewrite.

---

## 3. Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Backend API | Node.js + TypeScript (Express or Fastify) | Matches founder's existing JS/web familiarity |
| ML/Rendering service | Python (FastAPI) | Separate service, called internally by the backend API |
| Database | PostgreSQL | Relational; session/catalog/consent data is inherently relational |
| Object storage | S3-compatible bucket (AWS S3 or MinIO for local dev) | Garment images, rendered output images |
| Cache/session store | Redis | Transient pre-consent body data, RFID→session mapping, TTL enforcement |
| Queue | Redis Streams or a lightweight queue (BullMQ) | Decouples "render requested" from "render completed" for the in-aisle display |
| Kiosk / Display frontend | React (Vite) | Deployed as a kiosk-mode web app on in-store hardware |
| Admin dashboard frontend | React (Vite) + a component library (e.g., shadcn/ui or MUI) | Internal tool, prioritize speed over custom design |
| Auth | JWT-based, retailer-staff login for admin dashboard only (kiosks use a device API key, not user auth) | |
| Rendering model | Start with a hosted generative image-compositing API (e.g., a diffusion-based virtual try-on model) rather than training a custom model | Fastest path to MVP; swap for in-house model later once volume justifies it |
| Body shape estimation | Off-the-shelf pose/depth estimation library (e.g., MediaPipe Pose, or a depth-camera SDK if using ToF hardware) producing a parametric measurement set (not raw imagery) | |
| Infra | Docker Compose for local/dev; single-region cloud deployment for pilot (AWS or GCP) | Don't over-engineer multi-region for a 1-store pilot |

---

## 4. Repository Structure

```
mirra/
├── apps/
│   ├── kiosk/                 # React app — entry scan + consent UI
│   ├── display/                # React app — in-aisle try-on display
│   └── admin/                  # React app — retailer dashboard
├── services/
│   ├── api/                    # Node/TS backend — main REST API
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   ├── models/
│   │   │   ├── services/
│   │   │   ├── middleware/
│   │   │   └── index.ts
│   │   └── package.json
│   └── render-service/         # Python FastAPI — body modeling + rendering
│       ├── app/
│       │   ├── main.py
│       │   ├── body_model.py
│       │   ├── render.py
│       │   └── schemas.py
│       └── requirements.txt
├── packages/
│   └── shared-types/            # Shared TS types/interfaces used by api + frontends
├── infra/
│   ├── docker-compose.yml
│   └── migrations/              # SQL migration files
├── docs/
│   └── this file
└── README.md
```

---

## 5. Data Model

Use PostgreSQL. Below are the core tables — implement these first, exactly as named, before adding anything else.

```sql
-- Multi-tenant root
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Retailer staff (admin dashboard auth)
CREATE TABLE staff_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff', -- 'staff' | 'admin'
  created_at TIMESTAMPTZ DEFAULT now()
);

-- A single shopper visit
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) NOT NULL,
  rfid_tag_id TEXT NOT NULL,
  consent_given BOOLEAN NOT NULL DEFAULT false,
  save_profile BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'ended' | 'expired'
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ
);
CREATE INDEX idx_sessions_rfid ON sessions(rfid_tag_id, status);

-- Parametric body model — NOTE: no facial data, no raw images stored here
CREATE TABLE body_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id) NOT NULL,
  height_cm NUMERIC,
  shoulder_width_cm NUMERIC,
  chest_cm NUMERIC,
  waist_cm NUMERIC,
  hip_cm NUMERIC,
  inseam_cm NUMERIC,
  body_shape_vector JSONB, -- normalized parametric mesh params, no imagery
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Garment catalog
CREATE TABLE garments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) NOT NULL,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT, -- 'top' | 'bottom' | 'dress' | 'outerwear' | etc.
  color TEXT,
  size_options TEXT[],
  reference_image_url TEXT NOT NULL, -- source product photo used for compositing
  fit_metadata JSONB, -- e.g., garment measurements per size
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, sku)
);

-- A single try-on render request/result
CREATE TABLE render_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id) NOT NULL,
  garment_id UUID REFERENCES garments(id) NOT NULL,
  size TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'processing' | 'done' | 'failed'
  output_image_url TEXT,
  requested_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- Consent + retention audit trail
CREATE TABLE consent_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id) NOT NULL,
  event_type TEXT NOT NULL, -- 'consent_given' | 'consent_declined' | 'save_profile_opt_in' | 'data_deleted'
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**Deletion job requirement:** implement a scheduled job (cron, e.g. hourly) that finds sessions where `expires_at < now()` and `save_profile = false`, then hard-deletes their `body_models` row and any transient render inputs, and writes a `data_deleted` row to `consent_events` before deleting. `render_requests.output_image_url` may be retained longer in anonymized/aggregate form for analytics only if the tenant's policy allows it — default to deleting it too unless explicitly configured otherwise.

---

## 6. API Contract (Backend `services/api`)

All endpoints are prefixed `/v1`. Auth: kiosk/display use header `x-device-key`; admin dashboard uses `Authorization: Bearer <jwt>`.

### 6.1 Session Lifecycle

```
POST /v1/sessions
  body: { tenant_id, rfid_tag_id }
  → creates a session in 'active' status, expires_at = now + configurable TTL (default 4 hours)
  → returns { session_id }

POST /v1/sessions/:id/consent
  body: { consent_given: boolean, save_profile: boolean }
  → records consent, writes consent_events row
  → if consent_given=false, session is immediately marked 'ended' and no body model may be created

POST /v1/sessions/:id/body-model
  body: { height_cm, shoulder_width_cm, chest_cm, waist_cm, hip_cm, inseam_cm, body_shape_vector }
  → REQUIRES consent_given=true on the session, else 403
  → stores body_models row

GET /v1/sessions/by-rfid/:rfid_tag_id
  → used by the in-aisle display to resolve an active session from a scanned band
  → returns { session_id, has_body_model: boolean }

POST /v1/sessions/:id/end
  → marks session 'ended', releases the RFID tag mapping
```

### 6.2 Garment Catalog

```
GET  /v1/tenants/:tenantId/garments            # list, filterable by category/color/active
POST /v1/tenants/:tenantId/garments             # create (admin only)
PUT  /v1/tenants/:tenantId/garments/:id         # update (admin only)
DELETE /v1/tenants/:tenantId/garments/:id       # soft-delete via active=false (admin only)
POST /v1/tenants/:tenantId/garments/bulk-import # CSV/JSON bulk upload (admin only)
```

### 6.3 Try-On Rendering

```
POST /v1/render
  body: { session_id, garment_id, size }
  → validates session has a body_model and consent_given=true
  → enqueues a render job (calls render-service internally), creates render_requests row (status='pending')
  → returns { render_request_id }

GET /v1/render/:id
  → returns { status, output_image_url } — poll this from the display app, or use a websocket/SSE variant if the agent prefers real-time push
```

### 6.4 Admin/Analytics

```
GET /v1/tenants/:tenantId/analytics/summary
  → returns aggregate counts: sessions today, renders today, consent opt-in rate, top-viewed garments
  → MUST only return aggregated numbers, never per-shopper body measurements
```

---

## 7. Render Service Contract (`services/render-service`, Python/FastAPI)

This is an internal service only — never exposed directly to the internet. Called by the main API.

```
POST /internal/render
  body: {
    body_shape_vector: {...},
    garment_reference_image_url: str,
    garment_category: str
  }
  → runs the 2D generative compositing model
  → uploads result to object storage
  → returns { output_image_url }
```

**Implementation note for MVP:** Use a hosted/pretrained virtual try-on generative model via API call rather than training one from scratch. The service's job in the MVP is orchestration (fetch garment image, call the model, post-process, store result) — not building a novel rendering model. Model choice is an implementation detail the agent should research at build time for current best-in-class hosted options; this spec intentionally does not lock in a specific vendor since that landscape moves quickly.

---

## 8. Frontend App Requirements

### 8.1 Kiosk App (`apps/kiosk`)
- Screen 1: Welcome + plain-language explanation of what will be scanned, why, and retention period.
- Screen 2: Explicit consent toggle (default OFF) + separate "save my profile for next visit" toggle (default OFF). Cannot proceed to scan without Screen 2's primary consent = true.
- Screen 3: Camera/depth capture flow, calls `POST /v1/sessions` then `POST /v1/sessions/:id/consent` then `POST /v1/sessions/:id/body-model`.
- Screen 4: "You're all set — here's your band" confirmation, session_id encoded onto the RFID band via the reader hardware (hardware integration detail — stub this with a mock write in software-only dev environments).

### 8.2 Display App (`apps/display`)
- Idle state: shows the garment(s) at that rack.
- On RFID tag read: calls `GET /v1/sessions/by-rfid/:id`; if no session or no body model, show a friendly "scan at entry first" prompt.
- On valid session: for the garment(s) at this rack, call `POST /v1/render` per garment/size, poll `GET /v1/render/:id`, display result with a loading state (target: sub-5-second perceived wait; show a skeleton/shimmer while waiting).
- Let shopper cycle size/color; each change triggers a new render call.

### 8.3 Admin Dashboard (`apps/admin`)
- Login (JWT).
- Garment catalog CRUD + CSV bulk import.
- Analytics summary view (aggregate only, per Section 6.4).
- Consent/retention settings page (TTL configuration, save_profile default).

---

## 9. Build Order (give the agent this exact sequence)

**Step 1 — Infra & DB**
Set up `infra/docker-compose.yml` with Postgres, Redis, MinIO (S3-compatible local storage). Write migration files for every table in Section 5. Verify migrations run cleanly.

**Step 2 — Backend API skeleton**
Scaffold `services/api` with the endpoints in Section 6 as stubs returning mock data. Get the shared TypeScript types in `packages/shared-types` defined first, since kiosk/display/admin all depend on them.

**Step 3 — Session + consent flow (real, not mocked)**
Implement Section 6.1 fully, including the TTL/expiry logic and the enforcement rule that no body model can be written without consent. Write tests for the 403-without-consent case specifically — this is a compliance-critical path, not just a feature.

**Step 4 — Garment catalog**
Implement Section 6.2, including bulk import. Seed the dev database with ~20 sample garments (mock reference images are fine for dev).

**Step 5 — Render service (mocked renderer first)**
Build `services/render-service` with a fake renderer that just overlays a watermark/placeholder on the garment image, so the full API contract (Section 7) and async job flow work end-to-end before plugging in a real generative model. Swap the fake renderer for a real hosted try-on model only after the pipeline works end-to-end with the fake one.

**Step 6 — Kiosk app**
Build Section 8.1 against the real API from Steps 3–4. Use a mock/webcam-based capture in place of real depth-camera hardware for dev/demo purposes; keep the capture module isolated behind an interface so real depth-camera hardware can be swapped in later without touching the rest of the app.

**Step 7 — Display app**
Build Section 8.2 against the real render pipeline (Step 5, with the mocked renderer initially, then the real one).

**Step 8 — Admin dashboard**
Build Section 8.3 last — it's operationally necessary but not on the shopper-facing critical path.

**Step 9 — Deletion job**
Implement the scheduled deletion job described at the end of Section 5. Do not skip this — it's a compliance requirement, not a nice-to-have.

**Step 10 — Swap in real rendering model**
Only once Steps 1–9 work end-to-end with the mocked renderer, integrate a real hosted generative try-on model behind the same `services/render-service` contract.

---

## 10. Acceptance Criteria for "MVP Done"

- [ ] A shopper can complete the full kiosk flow and receive a session tied to a mock RFID tag.
- [ ] Consent is enforced server-side, not just hidden in the UI (verified by attempting the API call directly without consent and getting a 403).
- [ ] A display app, given a valid RFID tag, can request and receive a rendered try-on image for at least 3 different garments and 2 sizes each.
- [ ] Admin can add a new garment via the dashboard and it appears immediately in the display app's options.
- [ ] The deletion job successfully removes expired, non-saved session data and logs a `data_deleted` consent event.
- [ ] No facial imagery or facial landmark data exists anywhere in the database — confirm by manual schema/data review before demo.
- [ ] Basic analytics summary loads and shows only aggregate numbers.

---

## 11. Explicitly Out of Scope for This Build

Do not implement these yet — they belong to later phases per the business blueprint:

- Feature B (social-media style discovery, cross-store locator, recommendation engine).
- Multi-retailer / cross-tenant discovery features.
- Real 3D cloth-physics simulation rendering.
- Payment or checkout integration.
- Real depth-camera / RFID hardware SDK integration (build against interfaces/mocks; hardware integration is a separate, later task once physical hardware is chosen).
