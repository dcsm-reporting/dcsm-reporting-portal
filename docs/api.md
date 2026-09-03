# The API

Everything the portal shows goes through `https://dcsm-ki-portal.dcsm-reporting.workers.dev/api/*`.
The React pages are one client of it. A future office missionary can build
another (a Sheet, a Slides deck, a phone page, a whole new front end) without
touching the database. This page is the map. Routes live in
`src/server/index.ts`; the shapes are built in `src/server/service.ts`,
`publish.ts`, `friends.ts`, `slides.ts`.

## Conventions

- **Weeks** are the Monday of a Monday-to-Sunday IMOS week, ISO: `2026-08-24`.
  "Today", "this week" and "this month" are mission time (America/New_York).
- **Indicators** are keyed by IMOS id, never by column: `20` BC, `30` BD, `40`
  SA, `100` NP, `600` LMP, `300` NMS (`src/shared/ki.ts`). A cell is
  `{ code, goal, actual, pct }`; `goal` and `pct` are `null` when IMOS had no goal.
- **Errors** are JSON `{ error: "message" }` with 400 (bad input), 401 (not
  signed in), 403 (not allowed), 404, 422 (`kind: "validation"`, an import
  that was refused), 500.
- **Responses are cached** for up to an hour and refreshed after any write.
  Fields are only ever **added**, never renamed or removed. If a shape must
  change, the route's cache key is bumped (`docs/longevity.md` §11).
- Reads take parameters; nothing is hard-coded to "the current week".

## Who can call what

| Caller | How | Can reach |
|---|---|---|
| A signed-in viewer (Cloudflare Access + the viewer list) | the browser's Access cookie | every `GET`, the weekly workflow writes (import, not-reported acknowledgements, record a baptism) |
| An admin (Admin → Admin access) | same | everything, including structure, settings, recipients, export, raw payloads |
| The Baptisms (MLC) sheet script | `Authorization: Bearer <FRIENDS_SYNC_SECRET>` | `POST /api/friends/sync` only |
| The Slides deck script | `Authorization: Bearer <SLIDES_READ_SECRET>` | `GET /api/slides/*` only |

The two script paths skip the Access login (an Access "Bypass" rule per path)
and carry their own secret. A new integration should get its own secret and
its own path prefix the same way, so a leaked key exposes one feed, not the
portal.

## Reading

| Route | Parameters | Returns |
|---|---|---|
| `GET /api/me` | | `{ user, isAdmin, authorized }` |
| `GET /api/weeks` | | `{ weeks[{weekStart,weekLabel}], latest, expectedLatest, missing[], zones[] }` |
| `GET /api/week/:week` | | This Week: `zones[]`, `byZone{zone→{kiId→cell}}` incl. `MISSION`, `byArea{zone→{area→cell}}`, `mlc{this,last,lastWeekStart}`, `month{byZone,mlc,window,label,gaps}`, `bands`, `resolve{resolvedCount,unmapped[]}` |
| `GET /api/stakes/:week` | | `{ stakes[], byStake{stake→{wards{unit→{kiId→n}},total}}, stakeSeries{stake→[{weekStart,…}]} }` |
| `GET /api/trends` | `upTo`, `n` (weeks), `zone`, `mlcOnly=1` | `{ rows[], goals[] }`, one row per week with a value per indicator |
| `GET /api/chase/:week` | | Not reported: `{ open[], newThisTransfer[], acknowledged[] }` |
| `GET /api/publish/:week` | | Everything Publish renders: `board{zones,byZone,byArea,mlc,monthByZone,monthLabel,bands}`, `reports[]` (one per stake: unit table, totals, series, on-date, baptized, recipients), `layout`, `emailTemplate`, `unassigned[]`, `extraKeys[]` |
| `GET /api/friends` | `status=on-date|baptized|all`, `zone`, `stake` | `{ friends[] }`, each with name, zone, unit, stake, dates, ticks, `dropped`, `missingSince`, `leftSheetAt`, `extra{}` |
| `GET /api/friends/summary` | `week` | counts: on date, this week, overdue, baptized this month, last sync time and warnings |
| `GET /api/friends/by-stake/:week` | | `{ stake→{ onDate[], baptized[] } }` |
| `GET /api/friends/monthly` | `n` (months, ≤24) | `[{ month, confirmed, unverified }]` |
| `GET /api/reconcile` | `month=YYYY-MM` | named baptisms vs the indicator count, per stake, with the gap |
| `GET /api/console` | | the Monday checklist: `steps[]` with state and detail, `behind`, `missingWeeks`, `system{…}` |
| `GET /api/config` | | `{ config, defaults }`: MLC positions, zone order and exclusions, bands, expected area range, stake report layout, kept sheet columns |
| `GET /api/structure` | | `{ areas[], wards[], latestWeek }` (Admin → Areas & units) |
| `GET /api/crosswalk` | | the three identity tables raw: `{ canonical[], crosswalk[], areaWard[] }` |
| `GET /api/rollover/:week` | | the transfer diff for that week with suggestions |
| `GET /api/recipients` | | stake presidents and To addresses, the CC list, the cover-email template |
| `GET /api/admins` | | `{ admins[], viewers[] }` |
| `GET /api/data` | | import log, audit log (last 120), sync log (last 30) |
| `GET /api/data/raw/:week` | admin | the stored IMOS payload, verbatim |
| `GET /api/export` | admin | every table as one JSON file (streamed) |

## Feeds for scripts (bearer secret, no login)

| Route | Parameters | Returns |
|---|---|---|
| `GET /api/slides/weekly` | `week` (default: latest imported) | `{ week, subtitle, zones[{name,kis{BC,BD,SAC,NP,LWM,RCA→{goal,actual}}}], mission, mlc{thisWeek,lastWeek}, window, notes[] }` |
| `GET /api/slides/monthly` | `week` | the same over the four most recent weeks, plus `detail[]` per zone |

Numbers only. `docs/slides-deck.md` has the full shape and the setup.

## Writing

Weekly workflow (any signed-in viewer):

| Route | Body |
|---|---|
| `POST /api/import` | `{ rawJson, dryRun?, force? }`. Validates the pasted IMOS JSON; `dryRun` reports without storing; `force` accepts a non-Monday-to-Sunday range or a changed structure on a stored week. 422 with the reason when refused. |
| `POST /api/chase/:week/ack` | `{ imosAreaId, reason? }` acknowledge a not-reported area; `DELETE /api/chase/:week/ack/:imosAreaId` undoes it |
| `POST /api/friends/record` | `{ name, baptismDate, ward?, stake?, zone?, missionaries?, notes? }` record a baptism the sheet is missing; `DELETE /api/friends/record/:id` removes one |
| `POST /api/friends/:id/correct` | `{ reason? }` mark a baptism as "doesn't count" |
| `POST /api/console/check` | `{ stepId, checked }` (admin) tick a Console step |

Structure and settings (admin):

| Route | Body |
|---|---|
| `PUT /api/config` | `{ key, value }`; keys and validation in `src/server/config.ts`; a bad value is refused, never stored |
| `POST /api/rollover/:week/apply` | `{ areas[], wards[], retire[], validFrom?, transferDate? }` the accepted transfer plan |
| `POST /api/crosswalk/attach` | `{ imosAreaId, canonicalAreaKey, validFrom, note? }` |
| `POST /api/crosswalk/canonical` | `{ key, displayName, createdAt? }`; `/rename { key, displayName }`; `/retire { key, retired }` |
| `POST /api/crosswalk/mapping/close` | `{ imosAreaId, validFrom, validTo }` |
| `POST /api/crosswalk/ward` | `{ canonicalAreaKey, wardUnitId, wardName, stake, validFrom }`; `/close { …, validTo }` |
| `POST /api/ward/move` | `{ wardUnitIds[], stake, validFrom }` units moved to a stake (boundary change, new stake, merge) |
| `POST /api/ward/rename` | `{ wardUnitId, wardName }` |
| `POST /api/ward/retire` | `{ wardUnitId, validTo, mergedInto? }` |
| `POST /api/stake/rename` | `{ from, to }` cascades to units, recipients, friends |
| `POST /api/recipients` | one stake's president and To list; `/cc { ccAll[] }`; `/template { subject, body }` |
| `POST /api/admins` | `{ admins?[], viewers?[] }`; the saver must stay on the admin list |
| `POST /api/seed` | `{ weekStart, validFrom? }` first-time crosswalk seed from a stored week |

Every write is recorded in the audit log with the signed-in user.

## Sheet sync (bearer `FRIENDS_SYNC_SECRET`)

`POST /api/friends/sync { rows[] }` with the whole sheet each time. Rows are
`{ zone, name, ward, stake, missionaries, baptismDate, baptismTime, baptismAddress, attendedChurch2x, onBaptismCalendar, baptizedConfirmed, extra{} }`.
Returns `{ upserted, changed, retained, deactivated, missing, moved, warnings[], rejected? }`.
How matching, the grace period and the churn breaker work: `docs/friends-sheet-bridge.md`.

## Trying it

From a browser tab that is signed in, any `GET` works directly:
`https://dcsm-ki-portal.dcsm-reporting.workers.dev/api/weeks`.
Locally, `npm run dev:api` serves the same API on `http://localhost:8787`
with `DEV_USER` from `.dev.vars` as the signed-in user.

## Adding a route

1. Add it in `src/server/index.ts` next to its group; build the shape in the
   matching `src/server/*.ts` file.
2. If it is for a script, give it its own secret in `src/server/env.ts`, skip
   the Access check for its path in the auth middleware, and document the
   Access Bypass rule.
3. Cache with `cached(env, key, scope, fn)`; put a version in the key.
4. Add a row here.
