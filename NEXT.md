# Next up

Deferred work, roughly in priority order. Nothing here is urgent.

## 0. Two five-minute hand-offs from the 2026-09-03 hardening round

- **Paste the updated sheet script.** `apps_script/baptisms-sync.gs` now skips
  `#REF!` / `#N/A` rows and no longer sends a week key. The portal already
  copes with the old script, so this is not urgent, but the sync log will keep
  warning about error-token rows until it is pasted.
- **Turn on the Access token check** once you have the AUD tag in hand:
  `docs/access-token-check.md`. Two lines in `wrangler.toml`, one deploy.

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
