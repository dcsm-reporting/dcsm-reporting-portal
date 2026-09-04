# Next

Work not yet done, in priority order. Nothing here is urgent. The habits and
yearly checks that keep the portal alive are in `docs/longevity.md`.

## Hand-offs waiting on Noah

- **Access token check**: `docs/access-token-check.md`. Two lines in
  `wrangler.toml`, one deploy.
- **Backup cron, later in September 2026**: before arming it, change the cadence
  to monthly or point it at Cloudflare R2 (the dump is now about 33 MB and git
  keeps every copy), then add the two GitHub Actions secrets. `docs/backup.md`.
- **Decisions for the president or the Data Privacy Officer**: `docs/privacy.md` §6.

## Ideas worth building

Ranked by what they add per hour of work. None are started.

1. **Data-quality checks before publishing.** A Console panel that flags
   entry mistakes the boards hide: an area with no goal on any indicator, an
   area whose six numbers match last week exactly, an actual more than three
   times its goal, a zone whose total halved. About half a day.
2. **Per-area history across id changes.** An Area page: pick a canonical
   area, see its weekly numbers across every IMOS id it has had, plus who
   served there. This is what makes the crosswalk pay for itself. About a day.
3. **Baptismal-date readiness list.** Friends whose date is within 14 days
   and who lack the calendar tick or the church attendances. Cheap.
4. **Year in review.** Once two years exist: totals by month, baptisms by
   stake, this year against last, exported like the stake report.
5. **Missionary view.** A missionary's numbers across areas, from the weekly
   snapshot. Admin-only. About a day.
6. **A Feeds panel under Admin** showing when each script feed (sheet sync,
   Slides deck) last connected, and one read-only integration secret with a
   single Access Bypass path for future tools. An hour.

Deliberately not on the list: anything that sends email or messages on its
own, anything that logs into IMOS, and a second database. Those made the
previous systems fragile.

## Settled

- **Storage retention**: nothing to do. The sync log prunes itself; every
  other table fits a decade in the free tier; raw payloads are the audit
  trail and stay (`docs/anomalies.md`, "Data growth over years").
- **Roles**: viewer list and admin list under Admin → Admin access.
- **Monday MLC Slides**: reads the portal (`docs/slides-deck.md`).
- **Baptism goals**: Admin → Baptism goals; optional, any month editable; zone goals need not sum to the mission goal; "Suggest" fills zones from their share of recent baptisms (Trends → Baptisms by zone shows the shares). Shown on the Baptisms page, the Trends chart, the deck's zone chips, and the stake report tile when enabled. Next step when wanted: serve the deck's rosters from the portal too, so the Slides script stops reading the sheet.
