# Status

_Updated 2026-09-03. History is in `git log`; this page is only what is true now._

## Live

- **URL:** https://dcsm-ki-portal.dcsm-reporting.workers.dev, owned by the
  `dcsm.reporting@gmail.com` Cloudflare account, behind Cloudflare Access
  (`@missionary.org`, `@churchofjesuschrist.org`) plus the portal's own viewer
  list (Admin → Admin access).
- **Data:** 18 IMOS weeks (2026-04-27 to 2026-08-24, no gaps) plus, once loaded from Admin → Data, 174 Tableau history weeks back to 2023-01-01; 11 stakes
  fully mapped, the Baptisms (MLC) sheet synced every 15 minutes, the Monday
  MLC Slides deck reading `/api/slides`.
- **Migrations:** 0001 to 0014 applied locally and remotely.
- **Secrets set:** `FRIENDS_SYNC_SECRET`, `SLIDES_READ_SECRET`.
- **Last deployed with:** Node 24.19, wrangler 3 (its "out of date" warning is noise).

## Verified by

- `npm test`: 128 unit tests, including a byte-for-byte diff of the pipeline
  against the Python reference on 12 sample weeks.
- End-to-end suites run against a local Worker before each deploy (kept in the
  session scratchpad, not the repo): import and views (39 checks), a simulated
  transfer (60), unit changes (25), sheet columns (13), privacy (12), the
  Slides feed with the real Apps Script run under Node (37), and transfer-night
  sheet churn (28), baptism goals (31), Tableau history loads (27).

## Open hand-offs

- **Access token check**, next week: `docs/access-token-check.md`.
- **Weekly backup cron**: two GitHub Actions secrets, `docs/backup.md`.
- **Decisions for the president or the Data Privacy Officer**: `docs/privacy.md` §6.

## Where to look

| Question | Page |
|---|---|
| How is it built, and why this way | `ARCHITECTURE.md` |
| What happens when something unusual happens | `docs/anomalies.md` |
| Transfer week, day by day | `docs/transfers.md` |
| How areas, units and stakes are mapped | `docs/how-mapping-works.md` |
| The Baptisms (MLC) sheet sync | `docs/friends-sheet-bridge.md` |
| The Monday Slides deck | `docs/slides-deck.md` |
| Every API route | `docs/api.md` |
| Indicator history from Tableau | `docs/legacy-ki-export.md` |
| What keeps it alive for years | `docs/longevity.md` |
| Backups and recovery | `docs/backup.md` |
| Privacy assessment | `docs/privacy.md` |
| Ideas not yet built | `NEXT.md` |
