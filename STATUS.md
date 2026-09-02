# Build status — DCSM KI Portal

_Last updated: 2026-09-02 — deployed; Friends + reconciliation + historical backfill._

## TL;DR

**Live at `https://dcsm-ki-portal.dcsm-reporting.workers.dev`**, owned by the
`dcsm.reporting@gmail.com` Cloudflare account, gated by Cloudflare Access
(`@missionary.org` + `@churchofjesuschrist.org`). Remote D1 holds 12 real IMOS
weeks + the crosswalk + 563 friend records (137 from the live Baptisms (MLC)
sheet, 416 historical baptisms backfilled from five legacy sources).

The reporting pipeline is ported to TypeScript and **verified byte-for-byte
against the Python reference on all 12 sample weeks** (88 tests). Boards, month,
stakes, trends, chase list, weekly console, a full transfer/structure manager,
a read-only Data page, and a Friends module that mirrors the Baptisms (MLC)
sheet with a monthly baptism-reconciliation view.

D1 read cost is kept under the free-tier daily limit by a KV response cache +
query fixes; a paid plan is on for this month as a cushion, not a dependency.

What's left: **Publish** (board PNGs + stake-report email draft — recipients
from the EMAILS sheet), **directory sync** (optional now the EMAILS sheet
covers stake reports), the weekly `d1 export → git` cron, and bundle polish.

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
| **Friends** (`/friends`) | ✅ mirrors the Baptisms (MLC) sheet via `apps_script/baptisms-sync.gs` (auto-discovers tabs, 15-min trigger, bearer secret, Access-bypassed path). Read-only. Summary cards, zone/status filter, per-stake on-date + last-6-months baptized lists on the Stakes page. Portal **retains confirmed baptisms** after STLs cycle them out. Stable two-tier sync match (ward\|name\|date + reschedule fallback) — verified idempotent |
| **Friends → Monthly reconciliation** | ✅ per stake, the authoritative named count vs the KI-feed/Mission-Portal aggregate as a gap to close, plus a "disappeared near their date" list. Unverified (ZL-form-only legacy) tier excluded from the count and flagged |
| **Historical backfill** | ✅ 416 completed baptisms 2025-09…2026-08, reconstructed by a separate thread from five sources into `resources/wdcs_legacy_baptisms.csv`; `scripts/load_backfill.py` loads it. 284 confirmed / 132 unverified |
| **Data page** (`/data`) | ✅ read-only: imported weeks (+ raw payload download), friends-sync log, audit log |
| **Perf** | ✅ KV response cache (`src/server/cache.ts`, `CACHE` namespace) invalidated by version counters on write; route-level code splitting (main bundle 609 kB → 180 kB); error boundary; "signed in as" chip |
| **Deploy** | ✅ `npx wrangler deploy` from the repo. Migrations 0001–0008 applied to remote D1. `FRIENDS_SYNC_SECRET` set |
| **Local run** | ✅ `wrangler dev` + local D1, `npm run seed:local` — or `$env:BASE=<url>; npm run seed:local` against the deployed instance |

### Numbers cross-checked against the Python oracle

- MISSION NP 8-24 = **443 / 549 → 81 %** ✅
- MLC NP share 8-24 = **30 %** ✅
- month (Aug, last 4 wk) MISSION NP = 2081 / 2398 ✅
- stake resolution = **11 stakes, nothing unmapped** ✅
- 12-week mission series first/last rows ✅

## Not done yet

- **Publish** — board PNG export and the stake-report draft. Design: render the
  board component to canvas → `toBlob()` for PNG; stake report → formatted HTML
  the operator pastes into Gmail. Recipients from `Stake President Reports
  2.0.xlsx` → **`EMAILS`** sheet (per stake: To/CC/ZL/STL/AP/president) — so no
  directory sync needed for v1.
- **Historical KI backfill** (separate from the baptism backfill, which is done)
  — `Key Indicator Reporting.xlsx` → **`RemoveDuplicates`** sheet: ~5000 rows,
  2024-09-29 … 2026-08-31, one row per area per week, all 6 KIs goal + actual.
  Would extend Trends/Month back to 2024 (area/zone/mission level; no ward, so
  old-week stake reports stay blank). Plan: `POST /api/backfill` taking
  normalised rows into a synthetic `import_run` marked `source='legacy'`.
- **Directory sync** — optional now the EMAILS sheet covers stake reports. Would
  add leader name/phone to the Chase list.
- **`wrangler d1 export` cron** — weekly SQL dump committed to git as the
  off-box immutable backup. One GitHub Action.
- **`All Units & Addresses`** (in `Baptisms (MLC).xlsx`) — authoritative unit id
  → ward/stake/address; could firm up `area_ward` and add addresses.
- **Bundle** — code-split done (180 kB main); Recharts still lazy-loads on
  Trends/Stakes. Fine.

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
