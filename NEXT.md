# Next up

Deferred work, roughly in priority order. Nothing here is urgent.

See `docs/longevity.md` for the habits, credentials, and yearly check that
keep this running; the items below are work.

## 0. Two five-minute hand-offs from the 2026-09-03 hardening round

- **Paste the updated sheet script.** `apps_script/baptisms-sync.gs` now skips
  `#REF!` / `#N/A` rows and no longer sends a week key. The portal already
  copes with the old script, so this is not urgent, but the sync log will keep
  warning about error-token rows until it is pasted.
- **Turn on the Access token check** once you have the AUD tag in hand:
  `docs/access-token-check.md`. Two lines in `wrangler.toml`, one deploy.

## Ideas worth building (Noah asked for the unconstrained list, 2026-09-03)

Ranked by what they add per hour of work. None are started.

1. **Baptism goals.** A monthly and annual baptism goal per zone and for the
   mission (config table, edited under Admin), shown as a target line on the
   Baptisms bar chart, a progress tile on the Baptisms page and the stake
   report ("14 of 20 this month"), and a year-to-date pace. Optional per
   stake later. About half a day.
2. **Data-quality checks before publishing.** A panel on the Console that
   flags entry mistakes the boards otherwise hide: an area with no goal set
   on any indicator; an area whose six numbers are identical to last week
   (copy-forward); an actual more than three times its goal; a zone whose
   total dropped by half. About half a day.
3. **Per-area history across id changes.** The canonical-area layer exists
   but no report reads it. An "Area" page: pick a canonical area, see its
   weekly numbers across every IMOS id it has had, plus who served there
   (from `missionary_snapshot`). This is what makes the crosswalk pay for
   itself. About a day.
4. **Baptismal-date readiness list.** Friends whose date is within 14 days
   and who lack the calendar tick or the two church attendances — the list
   an STL needs on Sunday night. Cheap; the data is already there.
5. **Year in review.** Once two years exist: totals by month, baptisms by
   stake, this year vs last, exported as a PDF like the stake report.
6. **Missionary view.** A missionary's numbers across areas (from the
   snapshot table). Useful for MLC and for the president; sensitive, so
   admin-only. About a day.
7. **Monday MLC Slides repoint** (below, unchanged).
8. **Arm the weekly backup cron** (two GitHub secrets, five minutes). Not a
   feature, but the cheapest durability left on the table.

Deliberately not on the list: anything that sends email or messages on its
own, anything that logs into IMOS, and a second database. Those are the
things that made the previous systems fragile.

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

## 2. Storage retention — settled, nothing to do

Numbers and reasoning are in `docs/anomalies.md` ("Data growth over years").
`friend_sync` now prunes itself to 120 days; everything else is small enough
for a decade on the free tier, and `import_run.raw_json` is the audit trail
and should stay. Revisit only if D1's free storage tier shrinks.

## 3. Roles — DONE (2026-09-02)

Admin access is now an `admin_emails` allowlist, edited at **Admin → Admin
access**. Empty = everyone who signs in is an admin. A non-empty list hides the
Admin tab for others and 403s the structure/config/crosswalk/recipients write
routes; Import, Publish, and the weekly workflow stay open to any signed-in
user.
