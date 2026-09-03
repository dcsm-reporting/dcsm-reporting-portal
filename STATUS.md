# Build status — DCSM KI Portal

_Last updated: 2026-09-03 — hardening round: import correctness, mission-time-zone dates, sheet hygiene, gap detection, optional Access token check._

## 2026-09-03 follow-ups (units, sheet columns, Console, Baptisms split)

- **"Unit" everywhere a person reads it** (ward or branch); code keeps `ward`.
  Unit dissolved can record "merged into" (audit log); the surviving unit keeps
  reporting under its own org id so nothing else changes.
- **Console is admin-only** (tab hidden, route guarded, checklist ticks
  gated). Import and Publish stay open to every signed-in user.
- **Sheet columns are forwarded automatically.** Any column on the Baptisms
  (MLC) sheet the portal has no named field for arrives as `{header: value}`,
  is stored on the friend (`extra_json`, migration 0012), shows as a column on
  the Baptisms page, and is offered as an on-date column for the stake report
  (Admin → Stake reports). A renamed core column (Ward Name / Stake / Baptism
  Date) now warns in the sync log and turns the Console's sheet step amber.
- **Baptisms page split**: Friends & baptisms (list, filters in the page
  head, zone and show state in the URL) and **Monthly check** (`/baptisms/check`).

## 2026-09-03 "easy to adjust" round

Noah's questions: how modular is the stake report, how easy are ward and
stake changes, what should the Areas page show, does the rollover date match
the transfer day. Answers, now built:

- **The stake report is configuration.** Admin → Stake reports → "What the
  report contains": sections on/off and in order, which indicators, trend
  weeks, months of baptisms, headline tiles, on-date columns, an intro
  paragraph, a closing note, the subtitle, with a live preview on real data.
  Stored as `stake_report_layout`, validated on save, repaired on read. A new
  *kind* of section is still code: `src/shared/reportLayout.ts` + one case in
  `src/web/publish/stakeReport.tsx`.
- **Areas & wards is organised by event.** Quick actions at the top: wards
  moved to a stake (boundary change, new stake, merge; multi-select; a new
  stake is just a new name), ward renamed / branch became a ward, ward
  dissolved, stake renamed, and a pointer to Rollover for teaching-area
  changes. Two views: teaching areas (zone, IMOS id, ward names, stake, last
  reported, status) and wards (stake, covered by, org id, stake since, last
  reported). Endpoints `/api/ward/move|rename|retire`, admin-gated,
  effective-dated by reporting week.
- **Rollover records the transfer day.** Mappings stay dated by reporting
  week (numbers only exist per week); the actual transfer day (defaults to
  the Thursday) is written into each mapping's note and the audit log.
- `docs/longevity.md`: the list.

## 2026-09-03 transfer-proofing round

Measured on the twelve stored weeks (including the 27 August restructure):
ward org ids are stable (73 of 74 present every week), area ids churn
(+4/−2, then +9), zones did not move. IMOS returns each week's own
structure for historical pulls. Full rundown: `docs/transfers.md`.

**Fixed**

| Was | Now |
|---|---|
| The crosswalk was seeded once, effective 2026-08-24, so every earlier week showed all areas "unmapped" and the August per-stake baptism check parked three weeks under `(unmapped)` | Effective-dated lookups fall back to the nearest row (soonest later, else last earlier) when nothing covers a week. Pre-seed weeks resolve; a ward keeps its stake in a week no area covered it. "Unmapped" now means "never mapped". |
| Rollover never proposed closing a mapping or retiring an area, so retired areas and dead IMOS ids accumulated forever | **Areas gone from IMOS this week**: close the mapping at that week; retire the area when it was its only id (a renamed area under a new id is recognised as a successor, not a retirement). Attaching an id to a retired area un-retires it. |
| Ward suggestions came only from the static Area To Ward Key CSV, which goes stale as wards change | Suggestions from, in order: the org id's own history, a same-named ward's history, the CSV plus the bundled unit directory (`resources/units.csv`), the sibling ward in the same area, the area's CSV row |
| A ward applied before its area existed crashed on a foreign key; a hand-typed key with spaces or capitals was stored as-is | Skipped with a message; keys are slugged |
| Zone changes blocked "Structure up to date" forever (no action could clear them) | Zone changes are informational; **Use this order** applies the suggested board order in one click; a renamed excluded zone is flagged only when it actually disappeared |
| A leadership position IMOS renamed (e.g. a new `…_ASSISTANT` string) would silently drop those areas out of the MLC share | New position strings are detected per week; leadership-looking ones not in the MLC list are flagged on Rollover with a link to fix |
| Nothing said "a transfer landed" at import time | The Import page lists what moved vs the previous stored week (zones, areas, moves, renames, wards) and links to Rollover after commit; re-importing a stored week with a *different structure* needs "store anyway" |
| Numbers from an area closed mid-week were silently dropped | Still excluded from totals (matches the active-area rule), but listed with their counts as transfer-week notes so they can be compared with the Mission Portal |

**Proven by** `test/resolve.test.ts` (fallbacks, unit directory, vanished /
successor / ward-history suggestions) and a 60-check simulated transfer
against a local Worker: two areas deleted, one renamed under a new id, one
moved zone, a new zone built from two areas, a new ward in a mapped area, a
brand-new area with a brand-new ward, an area closed mid-week with numbers, a
zone renamed, a new position string; then apply, every view, and a retired
area returning the following week.

## 2026-09-03 hardening round (what changed and why)

A top-to-bottom review for "this has to last years". Every item below is
deployed; 103 unit tests plus a 39-check end-to-end script against a local
Worker are green. `docs/anomalies.md` is the new one-page answer to "what
happens when X".

**Bugs fixed**

| Was | Now |
|---|---|
| A payload with no `reportStart` was stored under an empty week key | Hard validation error; report dates must be real `YYYY-MM-DD` |
| A month range or Sunday-start week imported as one fake "week" | Refused unless the person ticks **store anyway** after seeing the warning |
| Re-importing a corrected week left rows for areas / wards / missionaries no longer in the report, so they kept being counted | Stale rows are removed after the upsert; the Import page reports how many |
| Re-importing an older payload after a newer one was a silent no-op | A no-op only when every stored row already came from that exact payload |
| A new Church indicator would block every import until code changed | Extra ids warn and are ignored; only a *missing* one of the six blocks |
| "Today", "this week", "this month", "overdue", "last complete week" were UTC, so on Sunday evenings Eastern the week rolled over early, that day's baptisms went overdue and the month flipped at 8 pm | All computed in `America/New_York` (`src/shared/dates.ts`), server and browser |
| `#REF!` / `#N/A` cells on the Baptisms sheet were treated as names | Skipped in the sheet script and again in the portal; counted in the sync warning |
| Every 15-minute sync rewrote every friend row (about 10k D1 writes/day) and reset `updated_at` on untouched rows | Only rows that differ are written |
| Removing a portal-recorded baptism failed once a weekly snapshot referenced it (foreign key) | Snapshot rows are removed with it |
| Renaming a stake orphaned its report recipients and the stake name on friend records | One rename updates ward rows, recipients and friends |
| The sheet's stake spelling had to match exactly ("Annandale Stake" fell off the report) | Matched ignoring case, accents and the word "Stake"; leftovers are listed on the Publish page |
| Zone lists in Trends / Baptisms were hard-coded | From stored data, in the configured order |
| The week picker did not offer a newly imported week until reload | Refreshed after every import |
| Attaching an IMOS id to a canonical key that does not exist blew up with a database error | Refused with a message; back-dated mappings are closed at the next one |
| Full backup export loaded every table into memory and skipped `console_check` | Streamed in row pages, includes every table, admin-only |
| `weeksAvailable` scanned every fact row on every call (several per uncached request) | One seek per import row |
| A malformed config write (bands amber above green, a string for a list) was accepted and could crash views | Validated on write; a bad stored value falls back to the default on read |

**New**

- **Missing-week detection**: the Console lists never-imported weeks and turns amber when the last complete week is not in yet; the Import page offers one-click buttons for each gap; "Last 4 weeks" flags a gap inside its window.
- **Expected active-area range** is a setting (Admin → Reporting settings), not a constant.
- **Optional Access token verification** (`docs/access-token-check.md`): closes the "spoofed identity header" hole if a second hostname is ever attached without Access.
- Friends weekly snapshot is filed under the current week and taken at least weekly; sync log self-prunes to 120 days.
- `docs/anomalies.md`: what the portal does, and what a person does, for every unusual situation we could think of.

## TL;DR

**Live at `https://dcsm-ki-portal.dcsm-reporting.workers.dev`**, owned by the
`dcsm.reporting@gmail.com` Cloudflare account, gated by Cloudflare Access
(`@missionary.org` + `@churchofjesuschrist.org`). Remote D1 holds 12 real IMOS
weeks (KI facts 2026-06-01 … 2026-08-24) + the crosswalk + ~500 friend records
(live Baptisms (MLC) sheet + 370 historical baptisms backfilled from five legacy
sources, confidence-tiered).

The reporting pipeline is ported to TypeScript and **verified byte-for-byte
against the Python reference on all 12 sample weeks** (88 tests). This Week /
Month / Stakes / Trends / Chase boards, an operations console, a full
transfer/structure manager, a read-only Data page with a one-click full backup,
a Friends module that mirrors the Baptisms (MLC) sheet with monthly baptism
reconciliation (and a portal-native way to record a baptism the sheet is
missing), and a **Publish** page that renders mission + zone board PNGs and
per-stake president reports with Gmail hand-off.

D1 read cost is kept under the free-tier daily limit by a KV response cache +
query fixes; a paid plan is on for this month as a cushion, not a dependency.

**Durability:** Cloudflare D1 time-travel (30 days, no setup) + `scripts/backup.sh`
(on-demand SQL dump) + a dormant weekly `d1 export → git` GitHub Action that
activates when the repo gets a remote. See `docs/backup.md`.

What's left: push the repo to GitHub + set the two Actions secrets to arm the
backup cron; optional directory sync for leader phone numbers on the chase list.
A historical KI backfill was attempted and **abandoned** — the legacy workbook
has no clean pre-IMOS weekly series (see note below).

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
| **Weekly console** (`/weekly`) | ✅ operations cockpit: weeks stored, zones/areas/stakes/chase counts, friends-sync freshness, reconciliation gap, a per-week checklist (import / crosswalk clean / structure current / chase / friends sync / reconciliation / boards / stake reports) with jump links |
| **Publish** (`/publish`) | ✅ Boards tab: mission + per-zone KI board components rendered to PNG via `html-to-image` (2×), MLC block. Stake reports tab: per-stake ward table + totals + 12-week sparkbars + on-date + last-6-months baptized, Print/Save-PDF, "Copy for email" (rich HTML), "Open in Gmail" deep link with To/CC from the recipients table. Recipients editor at Structure → Recipients (seed from the EMAILS sheet) |
| **Friends → record a baptism** | ✅ `POST /api/friends/record` — portal-native completed baptism for the case the Baptisms (MLC) sheet is missing one (STL deleted the row, late confirmation). Written `source='portal'`, authoritative, invisible to the sheet sync, dup-guarded on folded name+date; removable from the Friends list. Counts toward the reconciliation named total |
| **Backup / durability** | ✅ `/api/export` (all 14 tables as JSON, linked from Data), `scripts/backup.sh` (on-demand `wrangler d1 export`, keeps last 12), `.github/workflows/backup.yml` (weekly, dormant until repo has a remote + 2 secrets), `docs/backup.md` |
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

- **Arm the backup cron** — push the repo to a GitHub remote, add Actions
  secrets `CLOUDFLARE_API_TOKEN` (Account › D1 › Edit) and
  `CLOUDFLARE_ACCOUNT_ID`. `.github/workflows/backup.yml` then runs weekly. Until
  then: run `scripts/backup.sh` by hand before any migration/bulk load.
- **Directory sync** — optional now the EMAILS sheet covers stake reports. Would
  add leader name/phone to the Chase list.
- **`All Units & Addresses`** (in `Baptisms (MLC).xlsx`) — authoritative unit id
  → ward/stake/address; could firm up `area_ward` and add addresses.
- **Bundle** — code-split done (181 kB main); Recharts still lazy-loads on
  Trends/Stakes. Fine.

### Historical KI backfill — abandoned (2026-09-02)

Attempted to extend Trends/Month back to 2024 from
`resources/Key Indicator Reporting.xlsx`. The `RemoveDuplicates` / `Form
Responses` sheets are keyed by **form-submission timestamp, not report week**,
and only a rolling ~6-week transfer window is ever fully populated — so bucketing
by `monday_of(timestamp)` produced 88 "weeks" with 1–13 areas each (vs the real
~100). The `*Transfers Ago` snapshot sheets are single-week transfer-cycle dumps,
some with `#REF!` corruption, all mid-2026. No clean multi-year weekly series
exists in the workbook. Loaded then fully backed out
(`DELETE … WHERE import_run_id >= 900000`); `scripts/load_ki_history.py` removed.
Portal KI history correctly begins with the IMOS-paste era (2026-06-01).

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
