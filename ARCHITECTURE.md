# Architecture

Weekly Key Indicators reporting for the Washington DC South Mission: **one web
app**, owned by a role account, free to run, operable by a missionary with no
technical background, built to outlast the people running it.

## Why Cloudflare

| Requirement | How it is met |
|---|---|
| Free forever, no card | Workers, D1, KV and Access are first-party free tiers, not a startup's trial. |
| No credentials in the app | D1 binds directly to the Worker. Sign-in is Cloudflare Access; the app holds no passwords. Two bearer secrets exist, one per script feed. |
| Operable by a non-technical pair | One account, one repository, `npm run deploy`. Everything a person adjusts is a setting in the browser. |
| Survives owner turnover | The repository and `docs/` are the handover. No personal account is load-bearing (`docs/longevity.md`). |
| Who made each change | Access injects the signed-in email; every write lands in the audit log with it. |
| Immutable audit trail | Raw IMOS payloads are stored verbatim and never mutated; a weekly SQL dump goes to git once the cron is armed. |
| Never automate the Church login | IMOS JSON is pasted by hand on the Import page. |
| Nothing sends on its own | Reports are rendered in the app and handed to a person to send from their own Gmail. |

## Shape

```
        paste IMOS JSON            Baptisms (MLC) sheet          Slides deck script
              │                    (Apps Script, 15 min)        (Apps Script, Monday)
              ▼                            │ POST                       │ GET
  ┌───────────────────────────────────────▼────────────────────────────▼──────┐
  │  Worker (Hono)  src/server/                                                │
  │   /api/import  validate → normalise → D1        /api/friends/sync          │
  │   /api/week /stakes /trends /publish /console   /api/slides/:mode          │
  │   /api/rollover /crosswalk /ward /config …      (bearer secrets)           │
  └──────────────┬─────────────────────────────────────────┬──────────────────┘
                 │                                         │
          ┌──────▼──────┐                           ┌──────▼──────┐
          │ D1 (SQLite) │                           │  React SPA  │
          │ facts, map, │                           │  src/web/   │
          │ friends,    │        KV response cache  │  served by  │
          │ config, log │                           │  the Worker │
          └─────────────┘                           └─────────────┘
```

One deploy: the Worker serves `/api/*` and falls back to the built SPA.

## The pipeline (`src/pipeline/`)

Pure, tested, no platform dependencies. Ported one-to-one from the Python at
`../ki-pipeline/`, which stays the specification and test oracle: `npm run
oracle` runs the Python over the 12 sample weeks, `test/oracle.test.ts` diffs
the TypeScript against it.

| File | Responsibility |
|---|---|
| `readImos.ts` | load, validate (hard errors vs warnings), normalise to `KiFact` / `WardFact` / missionary and area-history rows |
| `identity.ts` | `normName` / `slug`: fold the area-name separators (`l`, `I`, `1`, `\|`, `/`) |
| `crosswalkSeed.ts` | payload + the Area To Ward Key CSV + `resources/units.csv` → canonical / crosswalk / unit rows |
| `resolve.ts` | effective-dated `imos_area_id → canonical_area_key → unit → stake`, with nearest-row fallback |
| `rollover.ts` | the transfer planner: what appeared, vanished, moved, and what to suggest |
| `rollup.ts` | `byZone`, `byArea`, `mlc`, `monthByZone`, `byStake`, `series`, `goalSeries`, `stakeSeries` |
| `friends.ts` | on-date rules, stake matching, de-duplication of baptisms |

Invariants: goal absent → `null`, never `0`; area actual sums every org
including Online; Online is never mapped to a unit; an MLC area holds an AP,
ZL, STL or STLT (configurable); percent is computed at render, never stored;
rounding is half-to-even like the Python.

## Data model (`migrations/`)

- `import_run` (raw payload, immutable), `ki_fact`, `ward_fact`,
  `missionary_snapshot`, `area_history` (per area per week, drives Not reported).
- `canonical_area`, `area_crosswalk`, `area_ward`: the identity spine,
  effective-dated (`docs/how-mapping-works.md`).
- `friend`, `friend_week` (weekly snapshot), `friend_sync` (log, self-pruned).
- `config` (every live setting), `stake_recipients`, `not_reported_ack`,
  `console_check`, `audit_log`.

## Identity: why it survives transfers

The old system keyed everything on a free-text area name. This one owns a
`canonical_area_key` that never changes; `area_crosswalk` maps IMOS's churning
area ids onto it with `valid_from` / `valid_to`; `area_ward` maps the key to
units keyed on the IMOS `org.id`, which has been stable across every stored
week. At a transfer, Admin → Rollover diffs the week and suggests the rows.
Earlier weeks keep their old mapping untouched.

## Auth

Cloudflare Access in front of the Worker (the two mission email domains), then
the portal's own viewer list and admin list (Admin → Admin access). The Worker
reads the Access email header; the optional signed-token check
(`docs/access-token-check.md`) makes a spoofed header worthless. Two paths
skip the login and carry a bearer secret instead: the sheet webhook and the
Slides feed.

## What comes from outside

Two pushes and nothing else: the Baptisms (MLC) sheet sends its rows, and the
Slides script reads numbers back. IMOS is pasted. Nothing is fetched from any
Church system.

## Server layout (`src/server/`)

`index.ts` routes and auth · `db.ts` D1 access · `service.ts` the views ·
`publish.ts` boards and stake reports · `friends.ts` the sheet sync ·
`slides.ts` the deck feed · `reconcile.ts` monthly baptism check ·
`config.ts` settings and validation · `cache.ts` KV cache · `auth.ts` token
check. Every route is listed in `docs/api.md`.
