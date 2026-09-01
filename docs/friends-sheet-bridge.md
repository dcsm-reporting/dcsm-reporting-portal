# Friends / on-date — keeping it in sync with the Baptisms (MLC) sheet

The **Baptisms (MLC)** Google Sheet stays the place Sister Training Leaders
actually edit. A small Apps Script bound to that sheet pushes a full snapshot to
the portal every few minutes; the portal's **Friends** page mirrors it
(read-only) and feeds the on-date / baptism lists on **Stakes**.

Two states only, matching the sheet: on a baptismal date, or baptized & confirmed.

## What syncs

Each per-zone tab (Alexandria, Annandale, …). The script finds the header row,
reads `Name / Baptism Date / Address / Time / Attended Church (Y/N) / Baptism
Calendar (Y/N) / Ward / Stake / Missionaries / Completed Baptism`, and posts them
to `POST /api/friends/sync`. `syncFriends()` then:

- upserts by a natural key `zone|ward|name` (so a rescheduled date just updates),
- **deactivates** anyone who dropped out of the sheet,
- takes a weekly snapshot into `friend_week` for the stake-report trends,
- logs the run to `friend_sync` (drives the "last synced" line on the page).

## One-time setup

### 1. The sync secret

Already set as a Worker secret (`FRIENDS_SYNC_SECRET`). To see or rotate it:

```bash
npx wrangler secret put FRIENDS_SYNC_SECRET
```

(The current value was handed to you in chat; keep it in the vault.)

### 2. Let the webhook through Cloudflare Access

The bridge isn't a logged-in user, so `/api/friends/sync` needs to skip the
Access login:

1. Zero Trust → **Access → Applications → Add an application → Self-hosted**.
2. Domain: `dcsm-ki-portal.dcsm-reporting.workers.dev` — **Path**: `api/friends/sync`.
3. Policy: Action **Bypass**, Include **Everyone**.
4. Save. (Path apps take precedence, so only that one endpoint is open — and it
   still requires the bearer secret.)

### 3. The Apps Script

1. Open the **Baptisms (MLC)** sheet → Extensions → **Apps Script**.
2. Paste `apps_script/baptisms-sync.gs` from this repo.
3. Project Settings → **Script Properties**:
   - `PORTAL_URL` = `https://dcsm-ki-portal.dcsm-reporting.workers.dev`
   - `SYNC_SECRET` = the `FRIENDS_SYNC_SECRET` value
4. Triggers (clock icon) → **Add Trigger** → function `pushToPortal`, event
   source **Time-driven**, every **15 minutes**.
5. Run `pushToPortal` once from the editor to authorize `UrlFetchApp` and do the
   first push. Check the execution log for `200 {...upserted...}`.
6. There's also a **KI Portal → Push to portal now** menu item in the sheet.

## Already loaded

The 137 current records (44 baptized, 93 on date) from the workbook were seeded
into production on 2026-09-01. The first Apps Script run reconciles against the
live sheet and takes over from there.
