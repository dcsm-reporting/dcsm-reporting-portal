# What happens when something unusual happens

The portal is meant to outlast the people running it. This page lists the
things that *will* happen over a few years and says, for each, what the
portal does on its own and what a person still has to do. If you hit a case
that is not here, add it.

## Weekly import

| Situation | What the portal does | What you do |
|---|---|---|
| The IMOS payload has no `reportStart` / `reportEnd`, or they are not `YYYY-MM-DD` | Refuses the import (hard validation error). Nothing is stored. | Re-pull from IMOS with the week selector on the Import page. |
| The range is not Monday to Sunday (a month, a single day, a Sunday start) | Validates, shows the warning, and refuses to store unless you tick **store anyway**. | Almost always re-pull the right week. Force only for a deliberate one-off, and know it will show as one "week" in trends. |
| The Church adds a seventh Key Indicator to the report | Imports normally; warns that the extra indicator is ignored. | Nothing, until the mission wants to report on it. Then add its id to `src/shared/ki.ts` (with a display code and name) and every grid picks it up. |
| One of the six indicators disappears from the report | Refuses the import. | This is a real change in what the Church reports. Decide with the mission president; the fix is a code change in `src/shared/ki.ts` plus the Python spec. |
| A week is re-imported after corrections in IMOS | Replaces every number for that week with the new pull, **and removes rows for any area, ward or missionary no longer in the report**. The Import page says how many stale rows went. | Nothing. Re-importing the identical payload is a no-op. |
| The active-area count looks wrong (mission grew or shrank) | Warns when the count is outside the configured range. | Adjust **Admin → Reporting settings → Expected active areas**. It is a sanity check, not a limit. |
| A week was never imported | The Console lists it under **Missing weeks**; the Import page offers a one-click button per missing week; the This Week "Last 4 weeks" view flags a gap inside its window. | Import it. Until then trends and 4-week totals skip it. |
| The latest complete week has ended but is not imported yet | The Console's first step turns amber and names the week. | Import it (Monday's job). |
| Someone pastes something huge or not JSON | Rejected with a clear message; nothing stored. | Paste the KI report JSON. |

## Transfers and structure

| Situation | What the portal does | What you do |
|---|---|---|
| Area ids change, areas split, zones renamed | Numbers still import (identity is not needed to store facts). This Week shows "N areas unmapped"; Stakes parks their wards under `(unmapped)`; the Console flags it. | **Admin → Rollover** for the new week: accept the suggestions, adjust the rest, Apply. Earlier weeks keep their old mapping. See `how-mapping-works.md`. |
| A stake is renamed or two stakes merge | **Admin → Areas & units → Stakes → Rename** updates the ward rows, the report recipients row, and the stake name on every friend record in one go. | Tell the STLs to use the new name on the sheet. |
| A zone is dropped or added | Trends, Baptisms and the Publish zone board list zones from stored data in the configured order, so nothing hard-coded goes stale. | Set the order under **Admin → Reporting settings → Zone order**. |
| A zone with baptism goals is renamed | Goals stay under the old name; the new name has none. | Re-enter them under the new name at Admin → Baptism goals; clear the old ones. |
| An admin attaches an IMOS id to a canonical key that does not exist | Refused with a message. | Create the area first, or tick "New?" in Rollover. |
| Back-dating a mapping under one that starts later | The new row is closed where the later one begins, so two mappings are never effective on the same week. | Nothing. |

## Baptisms (MLC) sheet

| Situation | What the portal does | What you do |
|---|---|---|
| A cell shows `#REF!`, `#N/A` or another spreadsheet error | The sheet script skips a row whose name is an error and blanks any other error cell; the portal does the same again. The sync log says how many rows were skipped. | Fix the formula on the sheet. |
| An STL sorts or restructures a tab while the 15-minute sync fires | The script waits two minutes after the last edit; if a pass still looks like a mass delete-and-reinsert, the portal rejects the whole pass (nothing applied) and logs why. | Nothing; the next tick retries. Use **KI Portal → Push to portal now** to force one. |
| STLs clear completed baptisms off the working tab at month end | Confirmed baptisms are **kept** (stamped with the date they left the sheet). | Nothing. Use **doesn't count** on the Baptisms page for a baptism that should not have been recorded. |
| An on-date friend is deleted from the sheet | Kept, marked "off the sheet since", for 48 hours; dropped only after that long of continuous absence. Reappearing on any tab inside the window clears it. | Nothing. |
| Transfer week: a friend is deleted from one zone tab and added on another, hours apart, sometimes with the unit typed differently | The same record is recognised (unit and name, or name and baptism date) and its zone or unit updated; history stays; the sync log notes the move. No drop, no duplicate. | Nothing. |
| A whole zone tab is renamed, hidden, or loses its "Name (First and Last)" header | Every friend on it would run out the grace period, so the sync warns that the zone had rows last time and none now; the Console's sheet step turns amber. | Fix the tab or header. |
| Someone deletes a friend near their baptism date without marking them baptized | Listed under **Removed from the sheet near their date** in the monthly check. | Ask the STL; record the baptism in the portal if it happened. |
| The stake column is blank or spelled differently ("Mount Vernon Stake", "annandale") | Matched to the known stakes ignoring case, accents and the word "Stake"; else the ward name is looked up; else the friend is listed on the Publish page as **on no stake report**. | Fix the stake on the sheet. |
| Same person entered twice (name order, accents, a Chinese name in brackets, dates a few weeks apart) | Collapsed to one baptism everywhere it is counted. | Nothing. |
| The sync stops arriving | Console step "Baptisms (MLC) sheet in sync" turns amber after 8 days. | Check the Apps Script trigger and the Access bypass rule (`friends-sheet-bridge.md`). |
| STLs add a column to the sheet | The header name is recorded; values are stored only once the office keeps the column under Reporting settings. Kept columns show on the Baptisms page and can go on the stake report. | Keep it if the president wants it; otherwise nothing. |
| STLs rename a column the portal depends on (Ward Name, Stake, Baptism Date) | The sync warns and the Console's sheet step turns amber; the field is blank until fixed. | Rename the header back, or add the new spelling to `FIELD_BY_HEADER` in the script. |
| A zone tab is added, renamed, or removed | Picked up on the next sync; zone filters follow. | Nothing. |
| A unit merges into another | Admin → Areas & units → Unit dissolved, with "merged into" recorded. The surviving unit keeps reporting under its own org id. | Nothing else. |
| It is Sunday evening | "This week", "this month" and "overdue" are measured on Eastern time, so nothing rolls over until midnight in the mission. | Nothing. |

## Accounts, access, hosting

| Situation | What the portal does | What you do |
|---|---|---|
| A new leader needs access | Nothing to deploy. | Their email domain is already allowed by the Access policy (`@missionary.org`, `@churchofjesuschrist.org`); for anyone else, add them in Zero Trust → Access. |
| Someone should be able to change structure, recipients or settings | Empty admin list = everyone; a non-empty list must include the person saving it (no lock-out). | **Admin → Admin access**. |
| A second hostname is attached, or the Access app is removed | With the optional token check on, spoofed identity headers are rejected. | Turn it on: `docs/access-token-check.md`. |
| The role account's Cloudflare or GitHub login is lost | Nothing; the data stays in D1 for 30 days of time travel plus the backups. | Keep both logins in the mission vault. Recovery steps in `backup.md`. |
| Free-tier limits | Every assembled page is served from a KV cache and only recomputed after a write; the sheet sync writes only rows that changed; the sync log is pruned to 120 days. | Nothing. If the D1 daily read limit is ever hit again, the KV cache is the first place to look. |

## Data growth over years

Real numbers on the current mission (about 107 areas, 12 zones):

| Table | Growth | 10-year size |
|---|---|---|
| `import_run` (raw payloads) | about 200–400 KB per week | about 150–200 MB, the only thing that matters |
| `ki_fact`, `ward_fact`, `missionary_snapshot`, `area_history` | about 1,600 rows per week | under 1 million rows, trivial for SQLite |
| `friend`, `friend_week` | a few hundred rows a year, one snapshot row per friend per week | small |
| `friend_sync` | pruned to the last 120 days automatically | bounded |
| `audit_log` | about 1,000 rows a year | small |

The free D1 tier is 5 GB. Nothing here needs a retention job for the
foreseeable future; the raw payloads are the audit trail and should stay.

## Comparing with the old decks

Two known, harmless differences. Monthly totals use the four most recent
imported weeks rather than a rolling calendar window, so a month can differ by
a few percent from the old sheet. Percentages round half-to-even like the
Python reference; the old Apps Script rounded half-up, a one-point difference
only on exact halves.
