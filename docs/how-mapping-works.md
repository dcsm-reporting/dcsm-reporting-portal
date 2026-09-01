# How the area / ward mapping works

The old system used the **teaching-area name** as the thing that tied everything
together. That name is free text, it's spelled inconsistently (`Alexandria 2 l
Assistants` vs `Alexandria 2 | Assistants`), and it changes at transfers — so
every transfer broke five different lookups. This system replaces that with a
small identity layer the mission owns. Three tables do all the work.

## The three tables

### 1. `canonical_area` — the stable name

One row per real teaching area, with a **key** the mission owns and never
changes:

| canonical_area_key | display_name        | created_at | retired_at |
|--------------------|---------------------|------------|------------|
| `fairfax`          | Fairfax             | 2026-08-24 | —          |
| `alexandria-a`     | Alexandria 1A       | 2026-08-24 | —          |
| `opal-auburn`      | Opal l Auburn       | 2026-06-01 | 2026-08-24 |

The key is a slug of the name the first time we see it. After that it's frozen —
IMOS can rename the area, split it, or change its id, and the key stays put.
`retired_at` is set when an area stops existing (its history stays queryable
under the key).

### 2. `area_crosswalk` — IMOS id → key, dated

IMOS identifies each area by a numeric `id` that **changes when the mission
president adjusts areas** (every few months to a couple years). This table maps
those churning ids onto the stable key, with a date range:

| imos_area_id | canonical_area_key | valid_from | valid_to   |
|--------------|--------------------|------------|------------|
| 488608442    | `fairfax`          | 2026-06-01 | 2026-08-24 |
| 500701221    | `fairfax`          | 2026-08-24 | —          |

Reading it: "for the week of 2026-07-06, IMOS id **488608442** is Fairfax; from
2026-08-24 onward, Fairfax is IMOS id **500701221**." A row with `valid_to = —`
is the currently-open mapping. When an id changes at a transfer you add a new
row from that week; the old row gets closed at the same date. Nothing is ever
deleted, so a chart that spans the change still resolves every week correctly.

### 3. `area_ward` — key → ward → stake, dated

IMOS gives you the KI numbers but **not the stake** — and a stake report needs
ward-level numbers grouped by stake. This table supplies that, keyed off the
IMOS `org.id` (the real Church **unit number**, which is far more stable than
the area id):

| canonical_area_key | ward_unit_id | ward_name   | stake         | valid_from | valid_to |
|--------------------|--------------|-------------|---------------|------------|----------|
| `fairfax`          | 18650        | Fairfax     | Annandale     | 2026-06-01 | —        |
| `opal-auburn`      | 55123        | Opal        | Gainesville   | 2026-06-01 | 2026-08-24|
| `opal-area`        | 55123        | Opal        | Gainesville   | 2026-08-24 | —        |
| `auburn-area`      | 61987        | Auburn      | Gainesville   | 2026-08-24 | —        |

One area can have several wards (a companionship covering two units). A split
shows up here as the old row closing and two new rows opening.

## How a week resolves

When you open **This Week** or **Stakes** for, say, `2026-07-06`:

1. Load the stored KI facts for that week — each carries an `imos_area_id`.
2. `area_crosswalk` rows effective on `2026-07-06` → `imos_area_id → key`.
3. `area_ward` rows effective on `2026-07-06` → `key → wards → stake`.
4. Roll the numbers up by zone, by area, by stake.

Any IMOS id with no crosswalk row for that week is **not dropped** — it's shown
as "unmapped" on This Week and lands under stake `(unmapped)` on Stakes, so you
always see it and can fix it.

## Transfers — the Rollover screen

`Structure → Rollover` does the whole diff for you. Pick the first week of the
new transfer and it compares that week's IMOS structure against the crosswalk:

- **New / retired zones** — listed with a badge.
- **Areas to map** — every IMOS area with no crosswalk row for the week. Each
  gets a **suggested canonical key**:
  - *exact match* (high confidence) — an existing key or display name matches
    the IMOS name → it's the same area under a new id; accept and it adds a
    crosswalk row, no new canonical area.
  - *known in the Area To Ward Key* (medium) — the name is in the CSV → it
    proposes a new canonical area with that key.
  - *new area* (low) — nothing matched → proposes a fresh key; you eyeball it.
  - Areas tagged **new** appeared this week but not last week — usually a
    **split**. Give each half its own key; its history starts there.
- **Wards to map** — org ids with no `area_ward` row for the week, each with a
  suggested stake (from the ward name in the CSV, else the area's row).

Tick "select suggested", scan the list, adjust anything, and **Apply effective
`<week>`**. That writes the crosswalk / ward rows dated from that week — every
earlier week keeps its old mapping untouched.

## Your three stale areas (Haymarket, Persian C, Loudoun C)

They showed on the Chase list because they had no IMOS `history` entry for the
week — but all three are **new this transfer** (not in the prior week's
payload), so a blank first week is expected, not a missed report. The Chase list
now labels them "new this transfer" and the summary calls that out. In Rollover
they'll appear under "Areas to map" tagged **new** — map each to its own
canonical key and you're done.

## Editing by hand — `Structure → Areas & wards`

Every canonical area is listed; expand one to:

- rename its display name, or retire / un-retire it,
- see its full IMOS-id history, close an open mapping, or attach a new id,
- see its ward rows, retire one, or add one,
- (bottom of page) rename a stake — updates every ward row under it.

`Structure → Crosswalk (raw)` is a plain table view of all three tables for
when you want to see exactly what's stored.
