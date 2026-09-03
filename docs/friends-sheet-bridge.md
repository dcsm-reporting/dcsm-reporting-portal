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

- matches rows two ways: exact `ward|name|date`, then a single unclaimed
  `ward|name` (so a rescheduled date just updates),
- writes only the rows that actually changed (an unchanged sheet costs no D1
  writes and leaves `updated_at` meaningful),
- **keeps** a confirmed baptism that leaves the sheet (the monthly STL
  clear-out) and marks an on-date friend who leaves as dropped,
- skips any row whose name cell is a spreadsheet error (`#REF!`, `#N/A`, …)
  and blanks such errors in every other cell (the script does the same before
  sending),
- refuses a whole pass that looks like a mid-edit or a sort (many inserts and
  drops at once) rather than guessing,
- files a snapshot into `friend_week` under the Monday of the current week
  (mission time zone) whenever something changed, and at least once per week
  regardless,
- logs the run to `friend_sync` (drives the "last synced" line on the page);
  log rows older than 120 days are pruned automatically.

## When the sheet changes

- **A new tab** (a new zone) is picked up on the next sync; the zone stored on
  each friend is the tab name. A tab removed takes its on-date friends off the
  list (marked dropped) and keeps its confirmed baptisms. Nothing to configure.
  The only hard-coded list is `SKIP_TABS` (helper tabs to ignore); a new helper
  tab that happens to contain the header row would be read as a zone, so name
  helper tabs distinctively or add them there.
- **A new column** is forwarded automatically as `{header: value}` and stored
  on each friend (`extra_json`). It shows up as a column on the Baptisms page
  on the next sync and can be ticked onto the stake report's on-date list at
  Admin → Stake reports. No code change.
- **A renamed column** is the one thing that needs attention. The script maps
  columns by header text (`FIELD_BY_HEADER`). If someone renames "Ward Name" to
  "Ward", the portal's ward field goes blank on every row and the value arrives
  as an extra column called "Ward" instead. The sync then warns ("no row carried
  a value for Ward Name"), the Console's sheet step turns amber, and the fix is
  either renaming the header back or adding the new spelling to
  `FIELD_BY_HEADER` (a one-line edit, plain text).
- **Row order, sorting, blank rows, `#REF!`** are all handled; see the list above.

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
