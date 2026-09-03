# Data privacy: what the portal holds and how it is protected

Written against General Handbook 33.6, 33.8 and 33.9 and the Church Privacy
Notice, 2026-09-03. The office should re-read this once a year and whenever a
new kind of data is added.

## 1. What is in the portal, and whose data it is

The handbook's rules are written mostly for members' data. The portal holds
three different kinds of people's data, and they deserve different care.

| Data | About whom | Members? | Where it comes from | Why it is held |
|---|---|---|---|---|
| Weekly Key Indicator counts by area, unit, zone, mission | nobody individually (aggregates) | n/a | IMOS report | the reporting itself |
| Missionary first and last names, IMOS id, position, area, per week | missionaries | yes | IMOS report (`missionary_snapshot`, and inside each stored raw payload) | which areas are MLC areas; who served where (not yet shown anywhere) |
| Friends with a baptismal date: name, unit, stake, zone, date, time, meetinghouse address, church attendance, calendar tick, teaching missionaries | people who are **not** members | no | Baptisms (MLC) sheet | on-date lists, stake reports, weekly counts |
| Baptized and confirmed: name, unit, stake, date (plus the legacy backfill with a confidence tier and notes) | new members | yes | Baptisms (MLC) sheet, portal record, legacy reconstruction | monthly and year-to-date counts, stake reports, the monthly check |
| Stake presidents' names and report recipients' email addresses; the mission-wide CC list | members and leaders | yes | seeded from the old EMAILS sheet, edited in Admin | addressing the stake reports |
| Who did what in the portal (email + action + time) | portal users | yes | Cloudflare Access identity | accountability (33.9) |

**Not held**: membership record numbers, any part of a membership record, home
addresses, phone numbers, birth dates, anything from LCR. The `baptism_address`
column is the meetinghouse. The old plan to sync leader phone numbers from
DCSM Contacts was never built and should stay unbuilt unless there is a stated
need.

**33.6 (membership records)** therefore does not apply directly: the portal
does not contain membership records. It does contain the fact of a person's
baptism and confirmation with a date, which is member data and is treated as
confidential below.

## 2. Limited to what the Church requires (33.8)

- Every column the portal stores from the Baptisms (MLC) sheet is named in the
  bridge script and used by a report. Any other column the STLs add is
  **dropped at sync** unless the office ticks it under Admin → Reporting
  settings → Baptisms (MLC) sheet: other columns. Only the header names are
  recorded until then, never the values.
- The raw IMOS payload is stored verbatim as the audit trail. It carries every
  missionary's name and position; the download is admin-only.
- Nothing is collected that no report uses. Before adding a field, ask what
  report needs it.

## 3. Used only for approved purposes and given only to those authorized (33.8)

- Sign-in is Cloudflare Access on the mission's email domains. On its own that
  admits every holder of an @missionary.org address, in any mission. The
  **viewer list** (Admin → Admin access → Who can view) narrows that to named
  people. **Set it.** The president, the assistants, the office, and whoever
  else the president approves. Everyone else sees a "not authorized" page.
- Admins (a second list) can change structure, units, stake reports, and
  settings, and can download the full database export and raw payloads.
- Stake reports carry friends' and new members' names for that stake only,
  and go to the stake president and the recipients the president has set.
  That is an approved purpose; a report should not be forwarded beyond them.
- Board images (PNGs) carry no names.

## 4. Protected against unauthorized access, change, destruction, disclosure (33.9.1)

| Where data lives | Protection |
|---|---|
| Cloudflare D1 (the database) | Encrypted at rest and in transit; reachable only from the Worker; the account is the role account with 2FA |
| Cloudflare KV (response cache) | Same account; entries expire within an hour |
| Cloudflare Access | Google sign-in on the mission domains; optional signed-token check (`docs/access-token-check.md`) |
| The Baptisms (MLC) Google Sheet | The STLs' working surface, under the mission's Google Workspace controls; the portal only reads it |
| Google Apps Script bridge | Runs as the sheet owner; sends to the portal over HTTPS with a bearer secret |
| Backups | D1 time travel (30 days); the weekly SQL dump to the **private** GitHub repository once armed; the admin JSON export |
| Office machine | Local development database and the source workbooks under `resources/` |

Change is logged (`audit_log`, visible under Admin → Data). Deletion of a
baptism record is not possible from the portal; "doesn't count" keeps the row
with a reason.

## 5. Things done on 2026-09-03 because of this review

- Source workbooks (`Baptisms (MLC).xlsx`, `Key Indicator Reporting.xlsx`,
  `Stake President Reports 2.0.xlsx`) and the legacy baptism list are no
  longer tracked in git. They remain on the office machine. **Git history
  still contains them**; purging history is possible (`git filter-repo`) if
  the president wants it.
- Raw IMOS payload downloads are admin-only.
- Sheet columns beyond the named fields are dropped unless explicitly kept.
- A viewer list exists. It ships empty; setting it is the office's next step.

## 6. Decisions for the mission president (or the Data Privacy Officer)

1. **Retention of names.** New members' names and baptism dates are kept
   indefinitely; the reports only need the current year plus six months. A
   rule such as "after two years, keep the count and drop the name" is easy
   to implement once decided.
2. **Third-party processors.** Friends' and members' names pass through
   Google (the sheet and the script), Cloudflare (hosting), and GitHub (the
   code, and the backups once armed). The old system used Google Sheets for
   the same data. If the mission wants a formal view, ask
   DataPrivacyOfficer@ChurchofJesusChrist.org, describing the table in
   section 1.
3. **Missionary names in the repository.** The twelve sample IMOS weeks in
   `samples/` carry missionary names and are used by the test suite. They
   could be anonymized without changing any test result.
4. **The backup destination.** A private GitHub repository is adequate; a
   Cloudflare R2 bucket in the same account would keep backups inside one
   provider. Either is fine; pick one and arm it.
5. **Minors.** The sheet does not record ages. If a friend with a baptismal
   date is a minor, nothing in the portal identifies that; the STLs' own
   handling applies.

## 7. Incidents (33.9.1)

If a device holding the local database or the source workbooks is lost, or
if portal data is disclosed to someone not authorized, report it at
incidents.ChurchofJesusChrist.org and rotate the sheet-sync secret
(`wrangler secret put FRIENDS_SYNC_SECRET`, then update the sheet's Script
Properties). Removing a person's access is Admin → Admin access.

## 8. Usernames and passwords (33.9.1.1)

Every person signs into the portal with their own Church or missionary
account through Cloudflare Access; no portal password exists and nothing is
shared. The role Gmail (`dcsm.reporting@gmail.com`) is an infrastructure
account for Cloudflare and GitHub only, held in the mission vault, and is not
a Church username.
