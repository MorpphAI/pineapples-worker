# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cloudflare Workers-based serverless REST API that automates cleaning schedules for accommodation management. It fetches check-in/out data from Avantio PMS, allocates tasks to cleaners, and generates Excel reports.

## Commands

```bash
# Local development (seeds local D1 DB, starts wrangler dev server)
pnpm dev

# Run tests (dry-run deploy + vitest)
pnpm test

# Deploy to production (auto-applies D1 migrations via predeploy hook)
pnpm deploy

# Apply D1 migrations locally
pnpm seedLocalDb

# Generate Cloudflare types from wrangler config
pnpm cf-typegen
```

**Local environment setup:** Create a `.dev.vars` file with:
```
AVANTIO_API_KEY=<your_key>
AVANTIO_BASE_URL=https://api.avantio.pro/pms/v2
```

## Architecture

**Stack:** Hono (web framework) + Chanfana (OpenAPI/Swagger) + Zod (validation) + Cloudflare D1 (SQLite) + XLSX (report generation)

**Layered architecture:**
```
Controllers (src/controllers/v1/) → HTTP layer, OpenAPI schema definitions
Services    (src/services/v1/)    → Business logic, scheduling algorithm
Repositories(src/repositories/)  → D1 database access
API Gateways(src/apiGateways/)   → External API integrations (Avantio)
Utils       (src/utils/)         → Pure functions (calculations, formatting)
Types       (src/types/)         → TypeScript interfaces and enums
```

**Entry point:** `src/index.ts` — Hono app with OpenAPI setup, route registration, and Swagger UI at `/`.

## Key Patterns

- **Controllers** extend `OpenAPIRoute` from Chanfana and define their schema (Zod) inline.
- **Services** receive `Env` via constructor and instantiate their own repositories/gateways.
- **Repositories** wrap D1 prepared statements; use `.batch()` for bulk inserts.
- **API Gateways** handle pagination and external HTTP calls; `AvantioApiGateway` auto-paginates.

## Database (Cloudflare D1)

Migrations live in `migrations/`. Key tables:
- `cleaners` — cleaner config (zones, shift times, fixed accommodations)
- `cleaner_off_days` — per-month off-day records
- `schedule_runs` — one row per schedule generation execution
- `schedule_items` — individual task assignments per run (FK → schedule_runs, CASCADE DELETE)

## Business Logic Highlights

**Schedule generation flow** (`PostScaleService`):
1. Fetch Avantio check-ins/checkouts → filter by booking status
2. Identify turnovers (same accommodation with both check-in and check-out)
3. Calculate cleaning effort by area (m²) → determines duration and team size
4. Prioritize: turnovers > check-ins > checkouts, then by team size, then by area
5. Allocate: fixed cleaners first → then general cleaners by zone match
6. Apply 30-min travel buffer between tasks; respect shift windows

**Cleaning effort table** (`src/utils/scaleUtils.ts`):
- <40m²: 1 person, 60 min | 40–70m²: 1 person, 90 min
- 70–90m²: 2 people, 120 min | 90–120m²: 2 people, 150 min | >120m²: 2 people, 180 min

**Zone extraction:** Parses accommodation names for `ZONA1`, `ZONA2`, etc., or `BARRA`. Accommodations without a recognized zone are skipped.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/scale` | Generate daily cleaning schedule |
| GET | `/v1/scale` | View schedule for a date |
| GET | `/v1/scale/{runId}/export` | Download Excel report |
| GET | `/v1/appointments` | Fetch Avantio check-ins/outs |
| POST | `/v1/cleaner` | Bulk create cleaners |
| GET | `/v1/cleaner` | List all cleaners |
| POST | `/v1/cleaner/offdays` | Register monthly off-days |
| GET | `/v1/cleaner/offdays` | Query off-days by month |
| GET | `/v1/priority` | Priority scores for tasks |
| GET | `/v1/priority/cleaner` | Priorities with cleaner assignments |

## Notes

- **Google Drive upload** is disabled — `DriveService` is a stub returning "disabled".
- **No authentication** on any endpoint currently.
- OpenAPI/Swagger docs auto-generated at `/`.
