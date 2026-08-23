# AAYNA — In-Store Body Scan + Virtual Try-On (Pilot Build)

Feature A MVP per `thoughts/shared/designs/2026-08-22-mirra-pilot-design.md`.

*Aaina (आईना) — "mirror." Your mirror, everywhere you shop.*

## Quick Start (local dev)

```bash
# 1. Infra: Postgres + Redis + MinIO (migrations auto-run on first boot)
npm run infra:up

# 2. Install deps
npm install

# 3. Run the backend API
npm run dev:api

# 4. Frontends (separate terminals)
npm run dev:kiosk
npm run dev:display
npm run dev:admin
```

## Layout

- `apps/kiosk` — entrance gate: hands-free walk-through body scan + band linking (no shopper interaction)
- `apps/display` — in-aisle try-on display
- `apps/admin` — retailer dashboard
- `services/api` — Node/TS REST API (Fastify)
- `services/render-service` — Python/FastAPI render orchestration + vendor adapters
- `packages/shared-types` — shared TS types
- `infra/` — docker-compose + SQL migrations

## Non-Negotiables (see design doc)

1. No facial geometry storage — ever.
2. Consent-first: no persistence before `consent_given=true`.
3. Session TTL deletion unless `save_profile=true`.
4. RFID = pointer, not identity.
5. Multi-tenant from day one.
6. Person frames live in Redis only, deleted after each vendor call.

## How the Gate Works

The entrance camera (`apps/kiosk`) watches continuously in MediaPipe VIDEO mode.
A stable full-body detection triggers a burst capture across the walker's
crossing; the sharpest/largest frame is kept and measured (pose landmarks →
proportions). The RFID band is read at the same gate — USB readers emulate
keyboards, so their keystrokes land in a global buffer with zero UI. When scan
and band both exist, the session is created, signage consent is logged
automatically (`consent_given`, no profile save), and the shopper's band is
live at every mirror.

Height note: a single entrance camera can't measure absolute stature, so the
gate uses a venue-configurable default — set `VITE_GATE_DEFAULT_HEIGHT_CM` in
`apps/kiosk/.env.development` (default 170). Proportions stay accurate, so size
recommendation is unaffected.

## Admin Dev Login

`admin@pilot.test` / `mirra-dev-2026`
