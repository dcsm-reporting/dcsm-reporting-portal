#!/usr/bin/env python3
"""Generate the test oracle: run the *Python* ki-pipeline over every sample week
and dump its rollup output as JSON. The TypeScript port is diffed against these
files in test/oracle.test.ts, so a regression in the port fails CI.

    python scripts/gen_oracle.py

Reads:  ../ki-pipeline/pipeline/*        (the reference implementation)
        samples/*.json                   (12 real IMOS weeks, copied in)
        resources/area-to-ward-key.csv
Writes: test/oracle/*.json
"""

from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
PIPELINE_REPO = ROOT.parent / "ki-pipeline"
sys.path.insert(0, str(PIPELINE_REPO))

from pipeline import db, read_imos, rollup  # noqa: E402
import crosswalk_seed  # noqa: E402

SAMPLES = sorted((ROOT / "samples").glob("20*.json"))
FIXTURE = ROOT / "test" / "fixtures" / "ki_sample.json"
AREA_KEY = ROOT / "resources" / "area-to-ward-key.csv"
OUT = ROOT / "test" / "oracle"
WIDE_BAND = (1, 200)


def norm(path: Path):
    payload = json.loads(path.read_text(encoding="utf-8"))
    return read_imos.normalize(payload, area_band=WIDE_BAND)


def zone_grid_json(grid: dict) -> dict:
    return {
        name: {str(ki): cell for ki, cell in kimap.items()}
        for name, kimap in grid.items()
    }


def mlc_grid_json(grid: dict) -> dict:
    return {str(ki): cell for ki, cell in grid.items()}


def by_stake_json(grid: dict) -> dict:
    return {
        stake: {
            "wards": {w: {str(k): v for k, v in kis.items()} for w, kis in s["wards"].items()},
            "total": {str(k): v for k, v in s["total"].items()},
        }
        for stake, s in grid.items()
    }


def seed_conn() -> sqlite3.Connection:
    conn = db.connect(":memory:")
    db.init_db(conn)
    ward_to_stake, area_to_ws = crosswalk_seed.load_area_key(AREA_KEY)
    from pipeline.constants import NON_WARD_ORG_IDS
    from pipeline.identity import norm_name, slug

    # seed the post-transfer structure from the most recent sample
    payload = json.loads(SAMPLES[-1].read_text(encoding="utf-8"))
    vf = payload.get("reportStart")
    for ctx in read_imos.iter_areas(payload):
        area = ctx.area
        if not read_imos.area_active(area):
            continue
        key = slug(area["name"])
        conn.execute(
            "INSERT OR REPLACE INTO canonical_area VALUES (?,?,?,NULL)",
            (key, area["name"], vf),
        )
        conn.execute(
            "INSERT OR REPLACE INTO area_crosswalk VALUES (?,?,?,NULL,'seed')",
            (area["id"], key, vf),
        )
        aws = area_to_ws.get(norm_name(area["name"]))
        for org in area.get("entities", []):
            if org.get("entityType") != "org" or org.get("id") in NON_WARD_ORG_IDS:
                continue
            stake = ward_to_stake.get(norm_name(org.get("name") or "")) or (aws[1] if aws else None)
            if not stake:
                continue
            conn.execute(
                "INSERT OR REPLACE INTO area_ward VALUES (?,?,?,?,?,NULL)",
                (key, org["id"], org.get("name") or "", stake, vf),
            )
    conn.commit()
    return conn


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    weeks = []

    for path in SAMPLES:
        res = norm(path)
        zones_present = sorted({f.zone_name for f in res.facts})
        entry = {
            "file": path.name,
            "week_start": res.week_start,
            "week_end": res.week_end,
            "n_facts": len(res.facts),
            "n_ward_facts": len(res.ward_facts),
            "n_missionaries": len(res.missionaries),
            "active_area_count": len(res.active_area_ids),
            "active_area_ids": sorted(res.active_area_ids),
            "warnings": res.warnings,
            "by_zone": zone_grid_json(rollup.by_zone(res.facts)),
            "mlc": mlc_grid_json(rollup.mlc(res.facts)),
            "by_area": {
                z: zone_grid_json(rollup.by_area(res.facts, z)) for z in zones_present
            },
        }
        (OUT / f"week-{res.week_start}.json").write_text(
            json.dumps(entry, indent=2, sort_keys=True), encoding="utf-8"
        )
        weeks.append({"week_start": res.week_start, "file": path.name})

    # cross-week: month window (last 4) + full-history series
    all_norm = [(p.stem, norm(p)) for p in SAMPLES]
    last4 = [n.facts for _, n in all_norm[-4:]]
    month = rollup.month_by_zone(last4)

    def series_pairs():
        return [(lbl, n.facts) for lbl, n in all_norm]

    cross = {
        "month_by_zone_last4": zone_grid_json(month),
        "month_window": [n.week_start for _, n in all_norm[-4:]],
        "series_mission": rollup.series(series_pairs()),
        "series_mlc_only": rollup.series(series_pairs(), mlc_only=True),
        "series_alexandria": rollup.series(series_pairs(), zone="Alexandria"),
    }
    (OUT / "cross-week.json").write_text(
        json.dumps(cross, indent=2, sort_keys=True), encoding="utf-8"
    )

    # crosswalk + stake rollup on the seeded structure, newest week
    conn = seed_conn()
    newest = all_norm[-1][1]
    ward_map = {
        r["ward_unit_id"]: (r["ward_name"], r["stake"])
        for r in conn.execute("SELECT * FROM area_ward").fetchall()
    }
    bs = rollup.by_stake(newest.ward_facts, ward_map)
    stake_entry = {
        "week_start": newest.week_start,
        "ward_map_size": len(ward_map),
        "stakes": sorted(bs.keys()),
        "by_stake": by_stake_json(bs),
        "canonical_area_count": conn.execute(
            "SELECT COUNT(*) c FROM canonical_area"
        ).fetchone()["c"],
        "area_crosswalk_count": conn.execute(
            "SELECT COUNT(*) c FROM area_crosswalk"
        ).fetchone()["c"],
        "area_ward_count": conn.execute("SELECT COUNT(*) c FROM area_ward").fetchone()["c"],
    }
    (OUT / "stake.json").write_text(
        json.dumps(stake_entry, indent=2, sort_keys=True), encoding="utf-8"
    )

    (OUT / "index.json").write_text(
        json.dumps({"weeks": weeks}, indent=2), encoding="utf-8"
    )
    print(f"wrote {len(list(OUT.glob('*.json')))} oracle files to {OUT}")
    print(f"  stakes resolved: {stake_entry['stakes']}")
    print(f"  '(unmapped)' present: {'(unmapped)' in bs}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
