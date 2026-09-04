# Legacy indicator history from Tableau

The portal's indicator history starts with the first IMOS paste (2026-04-27).
Tableau's "Missionaries Key Indicators" view holds the same numbers further
back, one row per teaching area per week. Loading that history would extend
Trends and make a year-in-review possible. This page says what file the
portal needs and gives a prompt for preparing it in a separate AI session.

## The short way

The loader at Admin → Data → **Load history from Tableau** reads Tableau's own
downloads as they come: in Tableau choose **Download → Crosstab → CSV** (not
Excel) on the *Missionaries Key Indicators* table and on the *People Baptized
and Confirmed* list, then pick each file on the page. Dates are read day-first
as Tableau shows them, checked against "must be a Sunday" for the weekly
file; icons Tableau appends to names are stripped. Nothing below is needed
unless a download comes in some other shape.

## The prepared file (optional)

One CSV, UTF-8, one row per teaching area per week, these exact headers:

```
week_end,area_id,zone,district,area,np_goal,np_actual,lmp_goal,lmp_actual,sa_goal,sa_actual,bd_goal,bd_actual,bc_goal,bc_actual,nms_goal,nms_actual
```

- `area_id`: the number at the start of Tableau's second column (`7461751, 01/01/2023`).
  It is the IMOS teaching-area id, the same one the portal keys on, so history
  joins the current mapping with no work.
- `week_end`: the Sunday that ends the week, `YYYY-MM-DD` (Tableau's "Sunday
  Date"). The portal derives the Monday.
- `zone`, `district`, `area`: exactly as Tableau shows them. Do not tidy the
  separators in area names (`Alexandria 2 l Assistants`); the portal folds them.
- The six indicators map from Tableau's column pairs:

  | Tableau | CSV |
  |---|---|
  | New People Goal / Actual | `np_goal`, `np_actual` |
  | Lessons with Member Participation Goal / Actual | `lmp_goal`, `lmp_actual` |
  | Potential Member Sacrament Goal / Actual | `sa_goal`, `sa_actual` |
  | Has Baptismal Date Goal / Actual | `bd_goal`, `bd_actual` |
  | Baptized and Confirmed Goal / Actual | `bc_goal`, `bc_actual` |
  | New Members at Sacrament Goal / Actual | `nms_goal`, `nms_actual` |

- Blank stays blank. Never turn a blank into 0: the portal treats a missing
  goal as "no goal", which matters for the percentages.
- No missionary names. The portal does not need them for history, and the
  file is easier to share without them.
- No totals rows, no subtotals, no `Null` area rows.

## Prompt for the preparation session

Paste the following into a separate AI session along with the Tableau
downloads (Excel or CSV, as many as it takes to cover the whole date range).

```
I have one or more exports from a Tableau view called "Missionaries Key
Indicators". Each export is a table with one row per teaching area per week.
Columns, in order: Sunday Date, Zone Name, District Name, Teaching Area Name,
missionary names, then twelve numeric columns in pairs of Goal and Actual for:
New People; Lessons with Member Participation; Potential Member Sacrament;
Has Baptismal Date; Baptized and Confirmed; New Members at Sacrament.
The date slider in Tableau limits each export to a window, so there may be
several files that overlap.

Produce ONE CSV file, UTF-8, with exactly this header line and nothing else
before it:

week_end,area_id,zone,district,area,np_goal,np_actual,lmp_goal,lmp_actual,sa_goal,sa_actual,bd_goal,bd_actual,bc_goal,bc_actual,nms_goal,nms_actual

Rules:
0. area_id is the number before the comma in the second column.
1. week_end is the Sunday Date as YYYY-MM-DD. Dates in the exports may be
   DD/MM/YYYY (the slider shows 30/06/2026) or MM/DD/YYYY; decide which by
   checking that every week_end you output is a Sunday, and tell me which
   format the files used.
2. zone, district, area are copied exactly as they appear, trimmed of
   surrounding whitespace only. Do not change punctuation or spacing inside
   the names.
3. Numeric cells are copied as integers. A blank cell stays blank. Do not
   write 0 for a blank. Do not compute anything.
4. Drop the missionary-names column entirely.
5. Drop rows whose area is blank or "Null", and any row that is a total or
   subtotal.
6. Where files overlap, keep one copy of each (week_end, zone, area) row. If
   two copies disagree, keep the one from the file with the later date range
   and list the disagreements for me.
7. Sort by week_end, then zone, then area.

Then report, in plain text:
- the first and last week_end, and the number of distinct weeks;
- the number of rows per week, flagging any week with fewer than 60 rows or
  more than 140 (a partial export or a duplicate);
- any week_end that is not a Sunday;
- any row where an Actual is more than 5 times its Goal, as a sanity check;
- the list of distinct zone names.

Give me the CSV as a downloadable file, not pasted in chat.
```

## The baptism list (optional second file)

Tableau's "Key Indicator Performance by Person" view lists, under "People
Baptized and Confirmed", every baptized person with the baptism date. That
list confirms the portal's legacy baptism records (the ones held as
"unverified") and fills months the old sheets missed. Only this panel is
wanted; the other four panels are live teaching lists the portal already
mirrors from the Baptisms (MLC) sheet.

One CSV, these headers:

```
external_id,name,baptism_date,zone,district,area
```

`external_id` is Tableau's first column (a person id); it keeps a second load
from duplicating anyone.

- `baptism_date` as `YYYY-MM-DD`; names exactly as shown, trimmed. Drop any
  emoji or icon characters Tableau appends to names.
- If the export does not carry zone and area, download once per zone with the
  zone filter set and add the zone column from the filter.

Add this to the preparation prompt:

```
I also have exports of a Tableau view called "Key Indicator Performance by
Person", panel "People Baptized and Confirmed": a name and a baptism date per
row, possibly with zone, district and teaching area. Produce a second CSV with
the header name,baptism_date,zone,district,area. Dates as YYYY-MM-DD (check
the day/month order the same way as before). Strip any emoji or icon
characters from names. Keep one row per (name, baptism_date). If a file came
from a single-zone filter, fill its zone column with that zone. Sort by
baptism_date then name, and report the first and last date and the count per
month.
```

## Loading the files

Admin → Data → **Load history from Tableau**. Pick the indicator file; the page
posts one week at a time and prints progress. Then pick the baptism file.
Both are safe to run again: a week already loaded is recognised by its
content, a week with an IMOS import is never overwritten, and a member is
recognised by the Tableau id.

What the load does:

- Each week becomes its own import run marked source "tableau", with the six
  indicators per area under the real IMOS area ids. No missionary or unit
  rows exist for those weeks, so the MLC share is empty there and stake
  reports never read them.
- Every area gets an area-history row, so a history week never shows as
  "not reported".
- A baptized member whose name and date (within 45 days) match a portal
  record is not added again; if that record was a legacy "unverified" one it
  becomes confirmed and gains the zone. Everyone else is added as a confirmed
  record with the Tableau area in the notes. Rows without a name are kept as
  "Member (Tableau id)" so the counts stay right. Tableau-only records never
  appear on the Publish page's "no stake report" list.

The first load was done on 2026-09-03: 192 weeks (2023-01-01 to 2026-08-30;
the 18 weeks with an IMOS import were left alone) and the baptism list back
to 2023.
