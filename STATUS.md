# Build status — DCSM KI Portal

_Last updated: 2026-09-01 — structure-management + weekly console added._

## TL;DR

The whole reporting pipeline is ported to TypeScript, **verified byte-for-byte
against the Python reference on all 12 real sample weeks** (81 automated tests),
and running end to end on a local Cloudflare stack. Import a week, see the
boards, drill into zones, view the month, stakes, trends, and the chase list —
all live against a real D1 database seeded with 12 weeks of history. The Admin
area is now a full **structure manager**: a guided transfer Rollover flow, a
canonical-area/ward editor, and live Config knobs (MLC positions, zone order,
colour bands) that take effect without a deploy. Plus a **Weekly console**
landing page that tracks the weekly routine as a checklist.

What's left: the Friends module, Publish (board PNGs + stake-report email
draft), historical backfill (needs your old export files), directory sync, and
the one-time cloud account setup.

## Done and verified

| Area | State |
|---|---|
| **Pipeline core** (ingest, validate, identity/slug, crosswalk seed, all 7 rollups, effective-dated resolve) | ✅ ported to TS in `src/pipeline/`, pure, no platform deps |
| **Oracle tests** | ✅ `npm run oracle` dumps the Python output; `test/oracle.test.ts` diffs the TS against it across 12 weeks — 54 assertions, all green |
| **Unit tests** | ✅ `test/pipeline.test.ts` + `test/identity.test.ts` — ports of the Python `test_pipeline.py` (24 tests) |
| **D1 schema** | ✅ `migrations/0001` + `0002` — mirrors `db.py` plus `area_history`, `friend`, `friend_status`, `directory_person`, `config`, `audit_log` |
| **Worker API** (Hono) | ✅ `/api/import` (validate + dry-run + commit), `/api/weeks`, `/api/week/:w`, `/api/trends`, `/api/stakes/:w`, `/api/chase/:w`, `/api/crosswalk` + attach/canonical/ward, `/api/seed` |
| **Import UI** | ✅ paste → validate (warnings, unmapped areas, counts) → commit |
| **This Week** | ✅ mission board, colour bands, MISSION row, zone→area drill-down, MLC share (this vs last) |
| **Month** | ✅ mission-at-a-glance, 4-week window |
| **Stakes** | ✅ per-stake ward table + totals, 12-week mini bar charts, stake picker |
| **Trends** | ✅ Recharts line chart, scope (mission / zone / MLC-only), window 4–52 wk, per-KI toggles |
| **Chase list** | ✅ areas with no IMOS `history[]` entry for the week (3 stale on 8-24, correct) |
| **Weekly console** (`/weekly`) | ✅ dashboard: weeks stored, zones/areas/stakes/chase counts, a per-week checklist (import / crosswalk clean / structure current / chase / boards / stake reports) with jump links |
| **Structure → Rollover** (`/admin/rollover`) | ✅ guided transfer flow — diffs the week's IMOS structure vs the crosswalk, proposes a canonical key per unmapped area (exact-match / CSV / new, with a confidence chip) and a stake per unmapped ward, "select suggested" + bulk **Apply effective `<week>`**. First-run seed button when no crosswalk exists. Pure planner in `src/pipeline/rollover.ts`, 3 tests |
| **Structure → Areas & wards** (`/admin/areas`) | ✅ all 107 canonical areas, filterable; expand a row to rename it, retire/un-retire, see + close effective-dated IMOS id mappings, add a mapping, see + retire ward→stake rows, add a ward row. Stake-rename (updates every ward row under it) |
| **Structure → Config** (`/admin/config`) | ✅ live knobs read from the `config` table on every request (no deploy): MLC positions (recomputed at read time, retro-applies), zone order, zones excluded from mission totals, colour bands |
| **Structure → Crosswalk (raw)** | ✅ read-only table view for debugging |
| **Local run** | ✅ `wrangler dev` + local D1, 12 weeks + crosswalk seeded (`npm run seed:local`) — 107 areas, 112 ward rows, 11 stakes, 0 unmapped |

### Numbers cross-checked against the Python oracle

- MISSION NP 8-24 = **443 / 549 → 81 %** ✅
- MLC NP share 8-24 = **30 %** ✅
- month (Aug, last 4 wk) MISSION NP = 2081 / 2398 ✅
- stake resolution = **11 stakes, nothing unmapped** ✅
- 12-week mission series first/last rows ✅

## Not done yet

- **Friends / on-date module** — ✅ built. `friend` + `friend_week` +
  `friend_sync` (migration 0003). `/friends` page (summary cards + filterable
  read-only table), on-date + baptism lists wired into `/stakes`. Source of
  truth stays the **Baptisms (MLC) Google Sheet**: `apps_script/baptisms-sync.gs`
  pushes a snapshot to `POST /api/friends/sync` (bearer secret, Access-bypassed
  path). 137 records seeded into production. Setup: `docs/friends-sheet-bridge.md`.
  _Remaining: the Apps Script + Access bypass rule are Elder Lake's to wire (2 steps)._
- **Publish** — board PNG export and the stake-report email draft. Design: render
  the board component to canvas → `toBlob()` for PNG; stake report → formatted
  HTML the operator pastes into Gmail (no email infra, no credentials).
- **Historical backfill from the old system** — files received (`~/Downloads/`):
  - `Key Indicator Reporting.xlsx` → sheet **`RemoveDuplicates`**: ~5000 rows,
    **2024-09-29 … 2026-08-31**, one row per area per week with all 6 KI
    goals + actuals + "People On Date". This is ~2 years of clean area-level
    history — the backfill source for `ki_fact` (mission/zone/area rollups +
    Trends back to 2024). No ward level, so old-week stake reports won't work.
    Sheet **`LeadershipAreas`** = the hand-maintained MLC area list per transfer
    (settles reconciliation #1).
  - `Baptisms (MLC).xlsx` → **`All Units & Addresses`** (unit id → ward / stake /
    address — authoritative, better than the fuzzy CSV); per-zone sheets =
    on-date/baptism friend records to seed the Friends module.
  - `Stake President Reports 2.0.xlsx` → **`EMAILS`** sheet = per-stake report
    recipients (To/CC/ZL/STL/AP/stake-president) — feeds Publish without needing
    DCSM Contacts.
  Plan: a `/api/backfill` that takes normalised `{weekStart, zone, area, goals,
  actuals}` rows (synthetic `import_run`, marked `source='legacy'`) + a parser
  script for `RemoveDuplicates`. Then load `All Units & Addresses` to firm up
  `area_ward`. **Next build.**
- **Directory sync** — `/api/directory/sync` reading DCSM Contacts. Needs the
  sheet shared to the role account and a small CSV/Sheets read. Chase list shows
  area + zone now; add the leader name/phone once the directory loads.
- **Data page** — read-only browse of stored weeks + raw payload download.
- **`wrangler d1 export` cron** — weekly SQL dump committed to git as the
  immutable audit trail. One GitHub Action.
- **Code-split the bundle** — 583 kB (Recharts). Lazy-load Trends/Stakes.
- **Auth polish** — `ALLOWED_EMAILS` env works; production uses Cloudflare
  Access (no code). Add a tiny "who am I" chip in the masthead.

## Reconciliation notes (unchanged from the old plan — settle in parallel week)

1. **MLC share runs high** — the rule flags ~40 areas as MLC (any AP/ZL/STL/STLT)
   vs the old hand-list of ~27. On 8-24 the portal shows NP share 30 %. Narrow
   `MLC_POSITIONS` in `src/pipeline/constants.ts` or add a config override once
   the old LeadershipAreas list is in hand. Config-only.
2. **Monthly totals** — portal uses the 4 most recent *stored* weeks; the old
   deck used a rolling 4-week window. Align the window; expect ~1–4 % drift,
   larger on NMS/RCA.
3. **Weekly mission totals** run ~1–2 % above the old numbers — expected, the old
   figures were Monday-night preliminary.
4. **Percent rounding** — the pipeline uses round-half-to-even (matches the
   Python). The old Apps Script decks used round-half-up: a ≤1-point cosmetic
   difference only on exact halves. `pyRound` in `src/pipeline/rollup.ts`.

## Your morning — ~20 min + the email

1. **Make the role Google account** (`dcsm-reporting@gmail.com` or similar),
   2FA on, creds → mission vault. _(the "email" you mentioned)_
2. **Cloudflare** — sign up free with that account (no card). Then, from this repo:
   ```bash
   npx wrangler login
   npx wrangler d1 create dcsm_ki          # paste the printed database_id into wrangler.toml
   npx wrangler d1 migrations apply dcsm_ki --remote
   npm run deploy
   ```
3. **Cloudflare Access** (Zero Trust dashboard → free plan): add an application
   in front of the Worker's URL, policy = the leader email list (or the mission
   Google Workspace domain). That's the whole auth story — no code.
4. **Seed production**: with the site up, run the import for each week (Import
   page) or point `BASE` at the deployed URL and run `npm run seed:local` once.
   Then Admin → “Seed crosswalk from 2026-08-24”.
5. If you'd rather deploy to **Vercel** instead — say so; the app is a React SPA
   + a thin Hono API. The main swap is D1 → Vercel Postgres/Neon and Access →
   NextAuth. I recommend Cloudflare; reasons in `ARCHITECTURE.md`.

## Run it right now (local)

```bash
npm install
npm run db:migrate:local
npm run build              # produces dist/client that wrangler dev serves
npm run dev:api            # http://localhost:8787  (Worker + D1 + built SPA)
npm run seed:local         # loads the 12 sample weeks + seeds the crosswalk
```

For UI iteration with hot reload: `npm run dev` (Vite on :5173 proxying /api to
:8787) — run `npm run dev:api` alongside it.
