# What happens at a transfer

Transfers rearrange teaching areas and zones every six weeks, usually
mid-week. This page is the exact sequence: what IMOS does, what the portal does
on its own, and the one thing a person does. It is written from what was
measured on the twelve stored weeks (June–August 2026, including the 27 August
restructure), not from theory.

A note on words: the portal's screens say **unit** for a ward or branch (an
IMOS org id). The code and this page sometimes say "ward" for the same thing.

## The three identifiers, and how stable each one is

| Identifier | Where it comes from | What it is used for | Observed churn over 12 weeks |
|---|---|---|---|
| **Zone name** | `zone.name` in the IMOS report | Boards, Trends by zone, zone order | 10 proselyting zones every week; none renamed or moved |
| **IMOS area id** | `area.id` | The key every weekly number is stored under | 109 seen, 94 present all 12 weeks; +4/−2 on 13 July, +9 on 24 August |
| **IMOS org id** ("ward unit id") | `org.id` under each area | Ward → stake for the stake reports | 74 seen, **73 present all 12 weeks**; the one that left was a ward whose only area closed |

Two things worth knowing about the org id:

- It is an **IMOS-internal identifier, not the Church's CDOL unit number**
  (the "All Units & Addresses" tab uses CDOL numbers, and they do not match).
  It is still the most stable key in the payload, because IMOS keeps one org
  record per ward regardless of which area covers it.
- The portal stores it as `ward_unit_id`, which is a misleading name. Nothing
  depends on it being the CDOL number; it only has to be stable, and it is.

## What IMOS does

IMOS returns the structure **as of the week you ask for**, not as of today.
Pulled together at the end of August, the June weeks came back with June's 96
areas, July with 98, and 24 August with 107, so a late pull of an old week is
safe. (Zone *reassignment* of an existing area was never observed in the
sample, so history-awareness for that specific case is not yet proven; the
Import page now says when an area moved zone between two stored weeks, so it
will be visible the first time it happens.)

An area closed mid-week keeps its area record but its last
`areaBookHistory` entry reads `enabled: false`. Numbers it entered before it
closed can still be in the payload (Old Town B carried one count in the week
of 6 July after closing). The portal excludes closed areas from every total
and now lists them, with their counts, as **transfer-week notes** on the Import
page so you can compare against the Mission Portal.

## What the portal does on its own

**Numbers never depend on the mapping.** The This Week board, the zone
boards, the MLC share, the monthly view, Trends by mission and by zone, and
the Not Reported list all read zone and area names straight from that week's
report. A transfer changes them automatically the week it lands. Nothing to do.

**Stake reports depend only on the ward org id.** `ward_fact` rows carry the
org id; the ward → stake table is keyed on it. Because the org id survives
area changes, a ward's numbers land on the right stake report through any
area rename, split, or merge. Only a **ward that has never been seen** (a new
unit the Church created, or a ward that was never covered by any area before)
needs a stake set once.

**Historical weeks resolve.** The ward → stake and area → canonical tables are
effective-dated, and when no row covers a week the nearest row is used (the
soonest later one, else the last earlier one). So weeks imported before the
first seeding resolve, and a ward keeps its stake in a week where no area
happened to cover it. An id is "unmapped" only if the mission has never
mapped it at all.

**The canonical area layer is a health check, not a dependency.** The
`canonical_area` / `area_crosswalk` tables give each real teaching area a name
that survives id changes. Today no report is computed from it; it drives the
"N areas unmapped" warning, the Areas & wards admin page, and Rollover. Its
value is for the future: a per-area history across id changes (see NEXT.md).
Leaving it unmapped for a week does not change any number on any report.

**Transfer detection at import.** When you validate a week whose structure
differs from the previous stored week, the Import page lists exactly what
moved: new zones, zones gone, new areas, areas gone, areas that changed zone,
renamed areas, new wards, wards no longer covered. After commit it links to
Rollover for that week. The Console's "Structure up to date" step turns amber
until Rollover is clean.

## What a person does (once per transfer, about five minutes)

1. **Monday**: import the transfer week as usual. Read the transfer block.
2. Open **Admin → Rollover** for that week. It shows:
   - **Areas to map**: every new IMOS area id, each with a suggested
     canonical key. "Exact key match" means the same area came back under a
     new id (accept it; its history continues). "New area" means a split or a
     genuinely new area (accept it; its history starts here).
   - **Wards to map**: every org id with no stake yet. Suggestions come, in
     order, from: this org id's own past mapping; a ward of the same name
     mapped before; the bundled Area To Ward Key and unit directory; the
     other ward in the same area; the area's own row in the key. A low
     confidence row means "type the stake".
   - **Areas gone from IMOS this week**: mapped ids that are no longer in the
     report. Ticking one closes the mapping at that week and, if it was the
     area's only id, retires the area (history stays; un-retire in Areas &
     wards if it comes back). Leave a row unticked if the area is only paused.
   - **Zones**: new or retired zones as chips; a one-click **Use this order**
     when the board order is stale; a warning if the zone excluded from
     mission totals is no longer in the report (renamed?).
3. Click **Select suggested**, scan, fix anything low-confidence, **Apply**.
   Everything is effective-dated from that week; earlier weeks keep their old
   mapping.

That is the whole transfer procedure. There is no spreadsheet to edit, no
list of leadership areas to maintain (MLC areas come from missionary
positions in the payload), and nothing to redeploy.

## The Baptisms (MLC) sheet at a transfer

The sheet script auto-discovers tabs, so a renamed or added zone tab is picked
up on the next sync with no change to the script. The zone stored on each
friend is the tab name, which is why the Baptisms page's zone filter also
lists zone names that exist only on the sheet. Stake names on the sheet are
matched tolerantly to the crosswalk's stakes; anyone unmatched is listed on
the Publish page.

## Things that would still need a human decision

- **A stake reorganisation** (wards moving between stakes, a stake created or
  dissolved). Set the new stake on the affected wards in Areas & wards with
  the effective date; rename or add the recipients row. Rare (years).
- **Two areas merged into one that keeps neither name.** Map the surviving id
  to whichever canonical area you want the history under; retire the other.
- **An IMOS id reused for a different area.** Never observed; ids look
  sequential. If it ever happens, close the old mapping at the week it changed
  and attach the id to the right canonical area from that week.

## The Baptisms (MLC) sheet during transfer week

STLs delete friends from one zone tab and re-add them on another, often
hours apart and sometimes with the unit typed differently. Nothing to do: an
on-date friend who vanishes is kept for 48 hours before being dropped, and a
re-added row is recognised as the same person by unit and name, or by name
and baptism date. The sync log notes each move. If a whole zone stops
arriving (a tab renamed or its name header changed), the Console's sheet step
turns amber and names the zone. Details: `docs/friends-sheet-bridge.md`.

## The Monday deck

The MLC Slides script reads zones from the portal, so a transfer needs no
change there. Rename or add the zone's "[Zone] Formatting" tab in Baptisms
(MLC) to match the new zone name; the script's log names any mismatch.
Details: `docs/slides-deck.md`.
