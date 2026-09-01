# DCSM KI Portal — architecture

A clean rebuild of the Washington DC South Mission's weekly Key Indicators
reporting: **one web app**, owned by a role account, $0 to run, operable by a
missionary with no technical background.

Supersedes the Google Apps Script proposal. Same principles, better platform.

## Why Cloudflare (not Apps Script, not Vercel)

| Requirement | How this design meets it |
|---|---|
| **$0 forever, no card** | Cloudflare Pages + Workers + D1 + KV are free with no card. All first-party — the free tier is a published product, not a startup runway. (Vercel's hosting is free but every DB option — Neon, Upstash — is a *separate* third-party free tier, the exact "free tier that can change" failure mode.) |
| **No credentials to store** | D1 binds directly to the Worker — no connection string. Auth is Cloudflare Access — no OAuth secret in the app. Deploys use `wrangler login` / the Git integration, not a secret in the repo. |
| **Operable by a non-technical pair** | One account (Cloudflare) + one GitHub repo. `npm run deploy`. Access allowlist edited in a dashboard. |
| **Survives owner turnover every 6–18 mo** | Everything is in the repo and one dashboard. `ARCHITECTURE.md` + `STATUS.md` are the handoff. |
| **Identify who made each edit** | Access injects `Cf-Access-Authenticated-User-Email` on every request — the STL-attribution problem the Apps Script design couldn't solve across domains. |
| **Immutable audit trail** | Raw IMOS payloads stored verbatim in `import_run` (never mutated) + a weekly `wrangler d1 export` committed to git. |
| **Never automate the Church login** | IMOS JSON is pasted by hand on the Import page. Unchanged. |
| **No autonomous outbound** | Stake reports are rendered in-app and handed to a person to send from their own Gmail. No mail infrastructure. |

## Shape

```
                 paste IMOS JSON
                        │
  ┌─────────────────────▼─────────────────────┐
  │  Worker (Hono)  — src/server/             │
  │   /api/import  validate → normalise → D1  │
  │   /api/week /trends /stakes /chase        │
  │   /api/crosswalk  /seed                   │
  └─────────┬───────────────────────┬─────────┘
            │                       │
      ┌─────▼─────┐          ┌──────▼───────┐
      │  D1 (SQLite)│         │ React SPA     │
      │  facts,     │         │ src/web/      │
      │  crosswalk, │         │ This Week /   │
      │  friends,   │         │ Month/Stakes/ │
      │  config     │         │ Trends/Chase/ │
      └────────────┘          │ Import/Admin  │
                              └───────────────┘
  one deploy: the Worker serves /api and falls back to the built SPA.
```

## The pipeline (`src/pipeline/`) — pure, tested, portable

Ported 1:1 from `../ki-pipeline/pipeline/*.py`, which stays the **specification
and test oracle**. `npm run oracle` runs the Python over the 12 sample weeks and
writes `test/oracle/*.json`; `test/oracle.test.ts` diffs the TypeScript output
against it. A drift in the port fails CI.

| File | Ported from | Responsibility |
|---|---|---|
| `readImos.ts` | `read_imos.py` | load, validate (hard vs warn), normalise → `KiFact` / `WardFact` / `MissionaryRow` / `AreaHistoryRow` |
| `identity.ts` | `identity.py` | `normName` / `slug` — fold the `l · I · 1 · \| · /` area-name separator |
| `crosswalkSeed.ts` | `crosswalk_seed.py` | payload + Area To Ward Key CSV → canonical / crosswalk / ward rows (100 % stake resolution on real data) |
| `resolve.ts` | `resolve.py` | effective-dated `imos_area_id → canonical_area_key → ward → stake` |
| `rollup.ts` | `rollup.py` | `byZone`, `byArea`, `mlc`, `monthByZone`, `byStake`, `series`, `stakeSeries` |
| `constants.ts` / `types.ts` | `constants.py` | KI ids, MLC positions, zone order/exclude, colour bands |

Key invariants preserved: goal absent → `null` not `0`; area actual = sum over
**all** orgs incl. Online; Online (`63939`) never mapped to a ward; MLC area =
holds an AP/ZL/STL/STLT; percent computed at render, never stored;
round-half-to-even (`pyRound`).

## Data model (`migrations/`)

Mirrors `db.py`: `import_run` (raw, immutable) · `ki_fact` · `ward_fact` ·
`missionary_snapshot`. Plus:

- `area_history` — per area per week, `updated_this_week` (from IMOS `history[].week`) → the Chase list
- `canonical_area` / `area_crosswalk` / `area_ward` — the identity spine, effective-dated
- `friend` + `friend_status` — STL-entered on-date names, weekly carry-forward snapshot _(schema only so far)_
- `directory_person` — the single external read (DCSM Contacts) _(not wired yet)_
- `config` — `mlc_positions`, zone order/exclude, colour bands, baptism baselines
- `audit_log` — who did what in the portal

## Identity — why it survives transfers

The old system used a free-text teaching-area name as a primary key in five
places. This one owns a `canonical_area_key` slug (`fairfax`, `alexandria-1a`)
that never changes. `area_crosswalk` maps churning IMOS area ids onto it with
`valid_from` / `valid_to`; `area_ward` maps the canonical key to wards anchored
on the **unit id** (`org.id`), which is stable. At a transfer, unmapped IMOS ids
surface on the Import page and in Admin with a one-field "attach to canonical
key" control — a handful, guided.

Seed once per structure: `POST /api/seed {weekStart}` reads that week's stored
raw payload + the bundled CSV. Run it for the post-transfer week, and again for
a pre-transfer week with an earlier `validFrom` so backfilled weeks resolve.

## Auth

Production: **Cloudflare Access** in front of the Worker URL, policy = leader
email list or the mission Workspace domain. Zero app code. The Worker reads
`Cf-Access-Authenticated-User-Email` for attribution. Local dev: `DEV_USER` var
stands in. Optional `ALLOWED_EMAILS` env is a secondary in-app gate.

## What still comes from outside

Exactly one thing: **DCSM Contacts**, shared read-only to the role account, for
leader emails/phones on stake reports and the Chase list. Cached in
`directory_person`; a sync failure falls back to the last copy.
