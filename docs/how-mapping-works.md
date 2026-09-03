# How the area, unit and stake mapping works

IMOS reports numbers per teaching area, identified by a numeric area id that
changes when areas are adjusted, and per unit (`org.id`), which has stayed
stable across every stored week. It does not say which stake a unit is in.
Three effective-dated tables supply the rest and survive transfers.

## The three tables

### 1. `canonical_area`: the stable name

One row per real teaching area, with a key the mission owns and never changes:

| canonical_area_key | display_name | created_at | retired_at |
|---|---|---|---|
| `fairfax` | Fairfax | 2026-08-24 | |
| `opal-auburn` | Opal l Auburn | 2026-06-01 | 2026-08-24 |

The key is a slug of the name the first time the area is seen. IMOS can
rename, split, or re-id the area and the key stays. `retired_at` is set when
the area stops existing; its history stays queryable.

### 2. `area_crosswalk`: IMOS area id → key, dated

| imos_area_id | canonical_area_key | valid_from | valid_to |
|---|---|---|---|
| 488608442 | `fairfax` | 2026-06-01 | 2026-08-24 |
| 500701221 | `fairfax` | 2026-08-24 | |

"For the week of 2026-07-06, id 488608442 is Fairfax; from 2026-08-24, Fairfax
is id 500701221." An open row has no `valid_to`. Nothing is deleted, so a
chart across the change resolves every week correctly.

### 3. `area_ward`: key → unit → stake, dated

| canonical_area_key | ward_unit_id | ward_name | stake | valid_from | valid_to |
|---|---|---|---|---|---|
| `fairfax` | 18650 | Fairfax | Annandale | 2026-06-01 | |
| `opal-auburn` | 55123 | Opal | Gainesville | 2026-06-01 | 2026-08-24 |
| `opal-area` | 55123 | Opal | Gainesville | 2026-08-24 | |

One area can cover several units. A split shows as the old row closing and
two new rows opening. The column is called `ward` in code; a unit may be a
ward or a branch.

## How a week resolves

1. Load the week's facts; each carries an `imos_area_id`.
2. Crosswalk rows effective that week give the key.
3. Unit rows effective that week give the unit and stake.
4. Roll up by zone, area, stake.

When no row covers a week, the nearest row is used (the soonest later one,
else the last earlier one), so weeks imported before the first seed still
resolve. An id that was **never** mapped is shown as "unmapped" on This Week
and parked under `(unmapped)` on Stakes, never dropped.

## Transfers: Admin → Rollover

Pick the first week of the new transfer. Rollover compares that week's IMOS
structure with the stored mapping and lists:

- **Areas to map**, each with a suggested key: an existing area whose name
  matches (the same area under a new id), a name known in the Area To Ward
  Key (a new area with that key), or a fresh key to eyeball. Areas tagged
  *new* were not in the previous week, usually a split.
- **Areas gone from IMOS**, with the mapping to close and, when it was the
  area's only id, the area to retire. A renamed area under a new id is
  recognised as a successor, not a retirement.
- **Units to map**, with a suggested stake from the unit's own history, a
  same-named unit, the CSV and the unit directory, or the area's other unit.
- **Zone changes** and any new leadership position string, for information.

Tick "select suggested", adjust, Apply. Rows are dated from that reporting
week; the actual transfer day goes into the note. Earlier weeks are untouched.
Day by day: `docs/transfers.md`.

## Between transfers: Admin → Areas & units

Quick actions for the events that happen: units moved to a stake (boundary
change, new stake, merge), a unit renamed or a branch becoming a ward, a unit
dissolved (with "merged into" recorded), a stake renamed (cascades to
recipients and friends). Every area can be expanded to rename, retire, see
its id history, close or add a mapping, and manage its unit rows.

`Admin → Crosswalk (raw)` is a plain view of the three tables.
