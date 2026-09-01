# Build status — DCSM KI Portal

_Last updated: overnight build, 2026-08-31 → 09-01._

## TL;DR

The whole reporting pipeline is ported to TypeScript, **verified byte-for-byte
against the Python reference on all 12 real sample weeks** (78 automated tests),
and running end to end on a local Cloudflare stack. Import a week, see the
boards, drill into zones, view the month, stakes, trends, and the chase list —
all live against a real D1 database seeded with 12 weeks of history.

What's left is mostly polish, the Friends module, and the one-time cloud
account setup (your job in the morning — see below).

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
| **Admin** | ✅ crosswalk stats, seed button, unmapped-area attach control |
| **Local run** | ✅ `wrangler dev` + local D1, 12 weeks + crosswalk seeded (`npm run seed:local`) — 107 areas, 112 ward rows, 11 stakes, 0 unmapped |

### Numbers cross-checked against the Python oracle

- MISSION NP 8-24 = **443 / 549 → 81 %** ✅
- MLC NP share 8-24 = **30 %** ✅
- month (Aug, last 4 wk) MISSION NP = 2081 / 2398 ✅
- stake resolution = **11 stakes, nothing unmapped** ✅
- 12-week mission series first/last rows ✅

## Not done yet

- **Friends / on-date module** — schema tables exist (`friend`, `friend_status`),
  no UI or routes. This is the STL-entered investigator names (§10 of the old
  spec). Next-biggest piece of work.
- **Publish** — board PNG export and the stake-report email draft. Design: render
  the board component to canvas → `toBlob()` for PNG; stake report → formatted
  HTML the operator pastes into Gmail (no email infra, no credentials).
- **Directory sync** — `/api/directory/sync` reading DCSM Contacts. Needs the
  sheet shared to the role account and a small CSV/Sheets read. Chase list shows
  area + zone now; add the leader name/phone once the directory loads.
- **Data page** — read-only browse of stored weeks + raw payload download.
- **Transfer rollover screen** — the guided "confirm zones / map new IDs" flow.
  The pieces exist (unmapped list + attach in Admin); this just wraps them.
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
