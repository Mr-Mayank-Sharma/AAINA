---
date: 2026-08-22
topic: "MIRRA Pilot Build — Consolidated Design (v2 spec + review resolutions)"
status: validated
---

# MIRRA Pilot Build — Consolidated Design

This document supersedes decision-relevant sections of MIRRA_Technical_Spec.md and incorporates all decisions from MIRRA Decision Log v2.0 plus resolutions from the design review sessions. It is the single source of truth for the planner.

## Problem Statement

Build a production-ready MVP of MIRRA Feature A — an in-store body-scan + RFID-linked virtual try-on system — for a paid 90-day pilot with one mid-size fashion retailer. The pilot must produce sellable evidence (conversion lift, render quality, per-vendor economics) to win retailer #2.

## Constraints (Non-Negotiable)

1. **No facial geometry storage** — facial landmarks discarded before any persistence; only body-shape/silhouette data stored.
2. **Consent-first** — no body-scan data persisted until `consent_given=true`; pre-consent data in Redis only, TTL ≤ 10 min.
3. **Session TTL by default** — end-of-day deletion unless `save_profile=true`.
4. **RFID is a pointer, not identity** — released at session end.
5. **Multi-tenant from day one** (`tenant_id` on all tables).
6. **Garment photos are the fabric/texture source of truth** — image-in/image-out render contract; no manual fabric tagging.
7. **Person-image disclosure** — webcam frame is transmitted transiently to the hosted vendor API for rendering; never written to object storage or Postgres; disclosed explicitly in kiosk consent Screen 1 ("a photo taken during your scan is sent to our rendering partner and not stored").

## Key Decisions (from Decision Log v2.0)

- **D1:** Paid, time-boxed (~90-day) pilot with defined success criteria.
- **D2:** Stand-and-scan kiosk (~2s webcam capture), not passive walk-through.
- **D3:** 2D generative-photo compositing, not 3D cloth simulation.
- **D4:** Buy the rendering model (hosted API), don't train.
- **D5:** Vendor bake-off: FASHN vs Kling Kolors vs Veesual via adapter interface before locking primary vendor.
- **D6:** No manual fabric metadata; catalog photo quality enforced via image QC.
- **D7–D10:** Privacy posture, RFID model, multi-tenancy, Feature B out of scope — carried forward unchanged.

## Resolved Review Items (NEW — must be implemented)

1. **RFID uniqueness:** add partial unique index on `sessions(rfid_tag_id)` where `status = 'active'`. Prevents two active sessions sharing one band.
2. **Deletion semantics:** deletion job anonymizes `sessions` rows (strip rfid_tag_id, retain row), hard-deletes `body_models`, cascades transient render inputs, retains `consent_events` permanently as BIPA audit trail (no biometric linkage remains).
3. **Consent events:** restore `'save_profile_opt_in'` event type; enum = `'consent_given' | 'consent_denied' | 'save_profile_opt_in' | 'data_deleted'`.
4. **Garment view events:** new lightweight table `garment_view_events(id, tenant_id, session_id, garment_id, created_at)` feeding "top-viewed garments" analytics. Written when display app shows a garment, independent of renders.
5. **Render caching (deferred but schema-ready):** design allows a future cache keyed on `(garment_id, size, coarse body-shape bucket)`. Not built in MVP; noted so no schema choice blocks it.
6. **Person-image flow (the blocking item):** kiosk capture produces a person frame → held in Redis-only transient storage → passed through render-service to vendor API per render call → deleted immediately after vendor response. Never touches S3 or Postgres. Consent language covers third-party transmission. Vendor DPA required before pilot launch.

## Architecture

Four surfaces + backend platform, all REST, single API gateway:

1. **Kiosk app** (React/Vite) — consent UX, webcam MediaPipe Pose capture, RFID issuance (mocked in dev).
2. **Display app** (React/Vite) — RFID read → fetch session → request/poll renders per garment/size.
3. **Admin dashboard** (React/Vite + shadcn/ui) — catalog CRUD + bulk import + image QC, aggregate analytics, retention settings.
4. **Backend API** (Node.js + TypeScript/Fastify) — sessions, consent ledger, catalog, render orchestration, analytics.
5. **Render service** (Python/FastAPI) — internal only; `TryOnVendor` adapter interface with FashnAdapter, KlingKolorsAdapter, VeesualAdapter; mocked renderer for pipeline bring-up.

Infra: PostgreSQL, Redis (transient pre-consent data + person frames + RFID map), S3-compatible storage (garment images + rendered outputs ONLY), BullMQ queue, Docker Compose dev / single-region cloud pilot.

## Data Flow (render path)

Display reads band → GET session by RFID → POST /v1/render → queue job → render-service pulls person frame from Redis (by session_id, TTL-enforced) + garment reference images from S3 → calls vendor adapter → uploads output to S3 → deletes person frame immediately → marks render_request complete → display polls and shows result.

## Error Handling

- Vendor failure: retry once, then mark render_request `failed`; display shows friendly retry state; failure counts feed per-vendor success-rate analytics.
- Missing/expired session at display: "scan at entry first" prompt.
- Consent enforcement server-side: body-model and render endpoints return 403 without consent (compliance-critical, must have explicit tests).
- Image QC failure: garment flagged, excluded from display options until re-uploaded.

## Testing Strategy

- Unit tests on consent/TTL enforcement logic (403 path is compliance-critical).
- Integration test: full kiosk→consent→body-model→render→display happy path against mocked renderer.
- Deletion job test: expired non-saved session fully anonymized/deleted with `data_deleted` event logged.
- Vendor bake-off harness: same body + 5–10 seeded garments across all three adapters, outputs documented for comparison.
- Manual pre-demo audit: zero facial imagery/landmarks anywhere in DB.

## Build Order

Per Decision Log v2.0 Section 10 (Steps 1–11), with Step 4 seeding real QC-passing photos, Step 6 being the vendor bake-off gate before any frontend work depends on real renders.

## Acceptance Criteria

Per Decision Log v2.0 Section 11, plus: RFID uniqueness constraint verified, deletion job anonymization verified, save_profile opt-in events logged.

## Open Questions

- RFID hardware vendor selection (mocked throughout build — separate later task).
- Confirm final photo minimums with locked vendor's docs.
- Pilot pricing structure (recommend discounted base + success-metric bonus).
