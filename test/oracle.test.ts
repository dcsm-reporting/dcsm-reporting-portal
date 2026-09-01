/**
 * The acceptance test: run the TypeScript pipeline over all 12 real IMOS sample
 * weeks and diff every rollup against `test/oracle/*.json`, which is generated
 * by the Python reference implementation (`npm run oracle`).
 *
 * A mismatch here means the port has drifted from the validated Python.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { normalize } from "../src/pipeline/readImos.js";
import { byArea, byZone, mlc, monthByZone, series, byStake } from "../src/pipeline/rollup.js";
import { loadAreaKey, seed } from "../src/pipeline/crosswalkSeed.js";
import { wardMapForWeek } from "../src/pipeline/resolve.js";
import type { ImosPayload, KiFact } from "../src/pipeline/types.js";

const dir = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf-8"));
const WIDE: [number, number] = [1, 200];

const SAMPLE_DIR = dir("../samples/");
const ORACLE_DIR = dir("./oracle/");

const sampleFiles = readdirSync(SAMPLE_DIR)
  .filter((f) => /^20\d\d-\d\d-\d\d\.json$/.test(f))
  .sort();

/** normalize() -> the same JSON shape the oracle stores for a zone grid. */
function zoneGridJson(grid: Record<string, Record<number, unknown>>) {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [name, kimap] of Object.entries(grid)) {
    out[name] = {};
    for (const [ki, cell] of Object.entries(kimap)) out[name]![String(ki)] = cell;
  }
  return out;
}
function mlcGridJson(grid: Record<number, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [ki, cell] of Object.entries(grid)) out[String(ki)] = cell;
  return out;
}

function normFile(file: string) {
  const payload = JSON.parse(readFileSync(SAMPLE_DIR + file, "utf-8")) as ImosPayload;
  return normalize(payload, { areaBand: WIDE });
}

describe("oracle: per-week rollups match the Python", () => {
  for (const file of sampleFiles) {
    describe(file, () => {
      const res = normFile(file);
      const oracle = readJson(ORACLE_DIR + `week-${res.weekStart}.json`);

      it("normalise counts + warnings", () => {
        expect(res.facts.length).toBe(oracle.n_facts);
        expect(res.wardFacts.length).toBe(oracle.n_ward_facts);
        expect(res.missionaries.length).toBe(oracle.n_missionaries);
        expect(res.activeAreaIds.size).toBe(oracle.active_area_count);
        expect([...res.activeAreaIds].sort((a, b) => a - b)).toEqual(oracle.active_area_ids);
        expect(res.warnings).toEqual(oracle.warnings);
      });

      it("by_zone (incl. MISSION)", () => {
        expect(zoneGridJson(byZone(res.facts))).toEqual(oracle.by_zone);
      });

      it("mlc", () => {
        expect(mlcGridJson(mlc(res.facts))).toEqual(oracle.mlc);
      });

      it("by_area for every zone", () => {
        for (const zone of Object.keys(oracle.by_area)) {
          expect(zoneGridJson(byArea(res.facts, zone))).toEqual(oracle.by_area[zone]);
        }
      });
    });
  }
});

describe("oracle: cross-week rollups", () => {
  const cross = readJson(ORACLE_DIR + "cross-week.json");
  const all = sampleFiles.map((f) => {
    const r = normFile(f);
    return { label: r.weekStart, weekStart: r.weekStart, facts: r.facts as KiFact[] };
  });

  it("month_by_zone over the last 4 weeks", () => {
    const last4 = all.slice(-4).map((w) => w.facts);
    expect(zoneGridJson(monthByZone(last4))).toEqual(cross.month_by_zone_last4);
  });

  it("series — whole mission", () => {
    const rows = series(all).map(({ weekStart, ...rest }) => rest);
    expect(rows).toEqual(cross.series_mission);
  });

  it("series — MLC only", () => {
    const rows = series(all, { mlcOnly: true }).map(({ weekStart, ...rest }) => rest);
    expect(rows).toEqual(cross.series_mlc_only);
  });

  it("series — one zone", () => {
    const rows = series(all, { zone: "Alexandria" }).map(({ weekStart, ...rest }) => rest);
    expect(rows).toEqual(cross.series_alexandria);
  });
});

describe("oracle: crosswalk seed + by_stake (100% stake resolution)", () => {
  const stake = readJson(ORACLE_DIR + "stake.json");
  let wardMap: Map<number, [string, string]>;
  let newest: ReturnType<typeof normFile>;

  beforeAll(() => {
    const areaKey = loadAreaKey(readFileSync(dir("../resources/area-to-ward-key.csv"), "utf-8"));
    const newestFile = sampleFiles[sampleFiles.length - 1]!;
    const payload = JSON.parse(readFileSync(SAMPLE_DIR + newestFile, "utf-8")) as ImosPayload;
    newest = normFile(newestFile);
    const seeded = seed(payload, areaKey, newest.weekStart);
    wardMap = wardMapForWeek(
      seeded.areaWard.map((r) => ({ ...r })),
      newest.weekStart,
    );
    // stash counts for the assertion below
    (stake as { _seed?: unknown })._seed = {
      canonical_area_count: seeded.canonicalAreas.length,
      area_crosswalk_count: seeded.areaCrosswalk.length,
      area_ward_count: seeded.areaWard.length,
      unresolved: seeded.unresolved,
    };
  });

  it("seed produces the same row counts as the Python", () => {
    const s = (stake as { _seed: Record<string, number> })._seed;
    expect(s.canonical_area_count).toBe(stake.canonical_area_count);
    expect(s.area_crosswalk_count).toBe(stake.area_crosswalk_count);
    expect(s.area_ward_count).toBe(stake.area_ward_count);
    expect((stake as { _seed: { unresolved: string[] } })._seed.unresolved).toEqual([]);
  });

  it("by_stake matches and nothing is unmapped", () => {
    const bs = byStake(newest.wardFacts, wardMap);
    const asJson: Record<string, unknown> = {};
    for (const [name, g] of Object.entries(bs)) {
      const wards: Record<string, Record<string, number>> = {};
      for (const [w, kis] of Object.entries(g.wards)) {
        wards[w] = {};
        for (const [k, v] of Object.entries(kis)) wards[w]![String(k)] = v;
      }
      const total: Record<string, number> = {};
      for (const [k, v] of Object.entries(g.total)) total[String(k)] = v;
      asJson[name] = { wards, total };
    }
    expect(Object.keys(bs).sort()).toEqual(stake.stakes);
    expect(Object.keys(bs)).not.toContain("(unmapped)");
    expect(asJson).toEqual(stake.by_stake);
  });
});
