# Next up

Deferred work, roughly in priority order. Nothing here is urgent.

## 1. Monday MLC Slides — repoint the weekly KIs to the portal

Keep the existing Apps Script (`resources/DCSM Key Indicator Reports - Slides
Refresh.gs`) — the drawing engine works well. Only the **weekly KI numbers**
still come from the retired reporting sheets; the rosters already come from
Baptisms (MLC) directly.

Plan (~half a day, low risk):

- Add an Access-bypassed, bearer-authed read endpoint on the Worker:
  `GET /api/slides/weekly` and `GET /api/slides/monthly`, returning exactly the
  shape the script's `gatherWeekly_` / `gatherMonthly_` / `readMLC_` produce:
  `{ subtitle, zones: [{ name, kis: { BC: {goal, actual}, ... } }], mission, mlc: { thisWeek, lastWeek } }`.
  Auth pattern = `/api/friends/sync` (bearer `SLIDES_READ_SECRET`, path excluded
  from the Access middleware).
- In the script, replace those three gatherers with `UrlFetchApp.fetch` to the
  endpoints. Leave the drawing code, roster reader, and social-media pinning
  untouched.
- New Worker secret `SLIDES_READ_SECRET`.
- Update the script's stale `SRC.ZONE_ORDER` to the current ten zones
  (`orderZones_` tolerates unknowns, but it should be right).
- Test with the script's `dryRun()` before pointing it at the live deck.

Until this lands, the deck can run off a hand-updated sheet.

## 2. Storage retention pass — low value, do once a year

Real growth is small: `ki_fact` / `ward_fact` / `missionary_snapshot` /
`area_history` are all trivial (<250k rows in five years) on a 5 GB free tier.
The only real grower is **`import_run.raw_json`** (~15-20 MB/year). `audit_log`
grows forever but slowly (~1k rows/year).

When it's worth an hour:

- A script that nulls `raw_json` on `import_run` rows older than ~18 months
  (keep the row; the blob is only needed to re-seed the crosswalk at transfers).
- Cap `audit_log` to the last ~2,000 rows.
- A `docs/retention.md` describing what grows and the yearly prune.

## 3. Roles — DONE (2026-09-02)

Admin access is now an `admin_emails` allowlist, edited at **Admin → Admin
access**. Empty = everyone who signs in is an admin. A non-empty list hides the
Admin tab for others and 403s the structure/config/crosswalk/recipients write
routes; Import, Publish, and the weekly workflow stay open to any signed-in
user.
