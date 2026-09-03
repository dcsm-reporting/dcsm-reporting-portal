# The Baptisms (MLC) sheet sync

The **Baptisms (MLC)** Google Sheet stays the place Sister Training Leaders
edit. An Apps Script bound to it (`apps_script/baptisms-sync.gs`) posts the
whole sheet to the portal every 15 minutes; the portal's Baptisms page
mirrors it and feeds the on-date and baptism lists on the stake reports.

## What the script sends

Tabs are discovered, not listed: any tab containing a cell that reads
`Name (First and Last)` is a data tab, and the tab name is the zone. Columns
are found by header text (`FIELD_BY_HEADER` at the top of the script), not by
position. Helper tabs are named in `SKIP_TABS`; the `Organized Baptisms`
history tab takes its zone from an "Actual Zone" column.

Per row: name, baptism date, time, address, attended church, baptism
calendar, unit, stake, missionaries, completed baptism, plus every other
column as `{header: value}`. Rows whose name is blank or a spreadsheet error
(`#REF!`, `#N/A`) are skipped. The script waits two minutes after the last
edit before sending, so a sort or a multi-row move is not caught halfway.

## What the portal does with it

Matching, in order, each pass:

1. **Exact**: same unit, name and baptism date.
2. **Rescheduled**: the one unclaimed row with the same unit and name.
3. **Moved**: the same name and baptism date on a different unit or zone tab
   (a transfer, a boundary change, a unit name typed differently), when
   exactly one candidate exists. The record and its history are kept; the
   sync log notes the move. A friend dropped within the last 60 days can be
   revived this way rather than duplicated.

Then:

- Only rows that differ are written, so an unchanged sheet costs nothing.
- A **confirmed baptism** that leaves the sheet (the monthly clear-out) is
  kept, stamped with the date it left.
- An **on-date friend** who leaves the sheet is stamped "missing" and kept for
  a **48-hour grace period**. They stay on every list. If they reappear on any
  tab inside the window, nothing happened. After 48 hours of continuous
  absence they are marked dropped. This is what makes transfer week safe:
  STLs delete from one zone tab and re-add on another hours apart, and the
  portal never sees a drop.
- Columns the portal has no named field for are stored only if the mission
  ticked them under Admin → Reporting settings; the header names are recorded
  so the office can decide.
- A pass that looks like a mid-edit or a sort (many inserts and drops at once)
  is refused whole and logged; the next tick retries.
- A **zone that had rows last time and none now** raises a warning and turns
  the Console's sheet step amber: its tab was renamed, hidden, or lost its
  name header.
- A renamed core column (Ward Name, Stake, Baptism Date) warns the same way.
- A snapshot is filed under the current week for the stake-report trends,
  whenever something changed and at least once a week.

## If the sheet changes

| Change | Effect |
|---|---|
| A column is added | Its header is recorded; values are kept only once ticked under Reporting settings. Nothing breaks. |
| Columns are reordered or moved | Nothing. Columns are found by header text. |
| Rows are inserted, sorted, or moved between tabs | Nothing. Matching is by content; moves are recognised. |
| The header row moves down | Nothing. The script searches for it. |
| A row is deleted | On date: kept 48 hours, then dropped. Baptized: kept forever. |
| A core header is renamed (Ward Name, Stake, Baptism Date) | That field goes blank; the sync warns; Console amber. Rename it back or add the new spelling to `FIELD_BY_HEADER`. |
| Another mapped header is renamed (Time, Address, the Y/N columns) | That field goes blank without a warning; the value arrives as an extra column. Same fix. |
| `Name (First and Last)` is renamed on a tab | The tab is no longer read; the zone-vanished warning fires; its friends run out the grace period unless fixed. Rename it back. |
| A tab is renamed | Every friend on it changes zone. Nothing else. |
| A helper tab gains the name header | It is read as a zone. Add it to `SKIP_TABS`. |
| A cell shows `#REF!` | The row is skipped if it is the name; other cells are blanked. Fix the formula. |

## One-time setup

1. `FRIENDS_SYNC_SECRET` is a Worker secret. Rotate with
   `npx wrangler secret put FRIENDS_SYNC_SECRET`, then update the sheet's
   Script Property.
2. Cloudflare Access must let the webhook through: Zero Trust → Access →
   Applications → Self-hosted, domain
   `dcsm-ki-portal.dcsm-reporting.workers.dev`, path `api/friends/sync`,
   policy **Bypass**, Everyone.
3. In the sheet: Extensions → Apps Script, paste the script, Script
   Properties `PORTAL_URL` and `SYNC_SECRET`, a time-driven trigger on
   `pushToPortal` every 15 minutes, run it once to authorize. The sheet also
   gets a **KI Portal → Push to portal now** menu.
