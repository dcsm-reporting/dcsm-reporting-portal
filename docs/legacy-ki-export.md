# Legacy indicator history from Tableau

The portal's indicator history starts with the first IMOS paste (2026-04-27).
Tableau's "Missionaries Key Indicators" view holds the same numbers further
back, one row per teaching area per week. Loading that history would extend
Trends and make a year-in-review possible. This page says what file the
portal needs and gives a prompt for preparing it in a separate AI session.

## What the file must look like

One CSV, UTF-8, one row per teaching area per week, these exact headers:

```
week_end,zone,district,area,np_goal,np_actual,lmp_goal,lmp_actual,sa_goal,sa_actual,bd_goal,bd_actual,bc_goal,bc_actual,nms_goal,nms_actual
```

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

week_end,zone,district,area,np_goal,np_actual,lmp_goal,lmp_actual,sa_goal,sa_actual,bd_goal,bd_actual,bc_goal,bc_actual,nms_goal,nms_actual

Rules:
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

## What happens next

Once the file exists, the portal gets a one-off loader that stores each week
as its own import run (source "tableau", no missionary or unit rows) and maps
area names onto the existing canonical areas where the names match, leaving
the rest as their own historical areas. Trends, the 4-week view, and any
year-in-review then read the whole span. Stake reports do not change: the
legacy rows carry no unit ids, so they never feed a stake total.
