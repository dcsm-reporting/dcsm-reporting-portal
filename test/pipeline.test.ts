/**
 * Ported from ki-pipeline/tests/test_pipeline.py — the same assertions against
 * the same synthetic fixture. If these pass, the TS port matches the Python on
 * validation, normalisation, and the core rollups.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isWeeklyPayload, normalize, validate, ValidationError } from "../src/pipeline/readImos.js";
import { byArea, byZone, goalSeries, mlc, series } from "../src/pipeline/rollup.js";
import type { ImosPayload } from "../src/pipeline/types.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/ki_sample.json", import.meta.url));
const WIDE: [number, number] = [1, 10];

function loadFixture(): ImosPayload {
  return JSON.parse(readFileSync(FIXTURE, "utf-8")) as ImosPayload;
}

describe("validate", () => {
  it("clean payload passes with no warnings", () => {
    expect(validate(loadFixture(), { areaBand: WIDE })).toEqual([]);
  });

  it("an extra KI id the Church adds later warns but does not block", () => {
    const p = loadFixture();
    p.keyIndicators!.push({ id: 999, name: "Bogus" });
    const w = validate(p, { areaBand: WIDE });
    expect(w.some((x) => x.includes("999") && x.includes("ignore"))).toBe(true);
  });

  it("a missing required KI id raises", () => {
    const p = loadFixture();
    p.keyIndicators = p.keyIndicators!.filter((k) => k.id !== 100);
    expect(() => validate(p, { areaBand: WIDE })).toThrow(ValidationError);
  });

  it("missing or malformed report dates raise (they are the storage key)", () => {
    const p = loadFixture();
    delete p.reportStart;
    expect(() => validate(p, { areaBand: WIDE })).toThrow(ValidationError);
    const q = loadFixture();
    q.reportStart = "08/17/2026";
    expect(() => validate(q, { areaBand: WIDE })).toThrow(ValidationError);
    const r = loadFixture();
    r.reportEnd = "2026-08-10"; // before start
    expect(() => validate(r, { areaBand: WIDE })).toThrow(ValidationError);
  });

  it("a month range or a non-Monday start warns and is not 'weekly'", () => {
    const p = loadFixture();
    p.reportStart = "2026-08-01";
    p.reportEnd = "2026-08-31";
    const w = validate(p, { areaBand: WIDE });
    expect(w.some((x) => x.includes("not a Mon–Sun week"))).toBe(true);
    expect(isWeeklyPayload(p)).toBe(false);
    const q = loadFixture();
    q.reportStart = "2026-08-16"; // a Sunday
    q.reportEnd = "2026-08-22";
    expect(validate(q, { areaBand: WIDE }).some((x) => x.includes("not a Monday"))).toBe(true);
    expect(isWeeklyPayload(q)).toBe(false);
    expect(isWeeklyPayload(loadFixture())).toBe(true);
  });

  it("not a mission payload raises", () => {
    const p = loadFixture();
    (p.entity as { entityType: string }).entityType = "zone";
    expect(() => validate(p, { areaBand: WIDE })).toThrow(ValidationError);
  });

  it("week mismatch warns", () => {
    const w = validate(loadFixture(), {
      expectedWeek: ["2026-08-17", "2026-08-23"],
      areaBand: WIDE,
    });
    expect(w.some((x) => x.includes("does not match requested week"))).toBe(true);
  });

  it("area-band warning fires with the default band", () => {
    const w = validate(loadFixture()); // default 95-120, fixture has 5
    expect(w.some((x) => x.includes("outside the expected band"))).toBe(true);
  });
});

describe("normalize", () => {
  const res = normalize(loadFixture(), { areaBand: WIDE });

  it("drops the inactive Service-zone area", () => {
    expect(res.activeAreaIds.has(500687953)).toBe(false);
    expect(res.activeAreaIds.size).toBe(5);
  });

  it("emits six facts per active area", () => {
    expect(res.facts.length).toBe(5 * 6);
  });

  it("an absent goal reads as null, not 0", () => {
    const p = loadFixture();
    const mtVernon = p.entity!.entities![0]!.entities![0]!.entities![0]!;
    mtVernon.kiData = mtVernon.kiData!.filter((k) => k.id !== 100);
    const r = normalize(p, { areaBand: WIDE });
    const np = r.facts.find((f) => f.areaId === 488608442 && f.kiId === 100)!;
    expect(np.goal).toBeNull();
  });

  it("actual sums all orgs including Online", () => {
    const np = res.facts.find((f) => f.areaId === 488608442 && f.kiId === 100)!;
    expect(np.actual).toBe(6); // Mount Vernon 6 + Online 0
  });

  it("MLC flag comes from missionary position", () => {
    const byAreaFlag = new Map<string, boolean>();
    for (const f of res.facts) if (!byAreaFlag.has(f.areaName)) byAreaFlag.set(f.areaName, f.isMlc);
    expect(byAreaFlag.get("Mt Vernon")).toBe(true);
    expect(byAreaFlag.get("Alexandria 2  l  Assistants")).toBe(true);
    expect(byAreaFlag.get("Lincolnia B")).toBe(true);
    expect(byAreaFlag.get("Fort Belvoir")).toBe(false); // DISTRICT_LEADER
    expect(byAreaFlag.get("Fairfax")).toBe(false); // TRAINER
  });

  it("missionary rows", () => {
    expect(res.missionaries.length).toBe(5 * 2);
    const peterson = res.missionaries.find((m) => m.missionaryId === 878360)!;
    expect(peterson.position).toBe("ZONE_LEADER_LEAD");
    expect(peterson.imosAreaId).toBe(488608442);
  });

  it("ward facts exclude Online", () => {
    expect(res.wardFacts.length).toBe(5 * 6);
    expect(new Set(res.wardFacts.map((w) => w.orgId)).has(63939)).toBe(false);
    const wf = res.wardFacts.find((w) => w.imosAreaId === 488608442 && w.kiId === 100)!;
    expect(wf.actual).toBe(6);
    expect(wf.orgName).toBe("Mount Vernon");
  });

  it("records area history for the chase list", () => {
    expect(res.areaHistory.length).toBe(5);
    expect(res.areaHistory.every((h) => "modifiedDate" in h)).toBe(true);
  });
});

describe("rollup", () => {
  const facts = normalize(loadFixture(), { areaBand: WIDE }).facts;

  it("zone and mission actuals", () => {
    const z = byZone(facts);
    const pick = (name: string) =>
      Object.fromEntries([20, 30, 40, 100, 600, 300].map((k) => [k, z[name]![k]!.actual]));
    expect(pick("Alexandria")).toEqual({ 20: 0, 30: 3, 40: 5, 100: 13, 600: 12, 300: 6 });
    expect(pick("Annandale")).toEqual({ 20: 0, 30: 1, 40: 3, 100: 15, 600: 16, 300: 2 });
    expect(pick("MISSION")).toEqual({ 20: 0, 30: 4, 40: 8, 100: 28, 600: 28, 300: 8 });
  });

  it("mission goal and pct", () => {
    const z = byZone(facts);
    expect(z.MISSION![100]!.goal).toBe(41);
    expect(z.MISSION![100]!.pct).toBe(68); // 28/41
  });

  it("a zero group goal shows a dash (null pct), not 0%", () => {
    const z = byZone(facts);
    expect(z.Annandale![20]!.pct).toBeNull();
  });

  it("MLC share", () => {
    const m = mlc(facts);
    expect(m[100]!.mission).toBe(28);
    expect(m[100]!.mlc).toBe(20); // 6 + 3 + 11
    expect(m[100]!.share).toBe(71);
  });

  it("byArea carries the zone total row", () => {
    const rows = byArea(facts, "Alexandria");
    expect(rows["Mt Vernon"]).toBeDefined();
    expect(rows.ALEXANDRIA).toBeDefined();
    expect(rows.ALEXANDRIA![100]!.actual).toBe(13);
  });

  it("series is actuals, goalSeries is the summed goals, same shape", () => {
    const wk = [{ label: "w1", weekStart: "2026-08-17", facts }];
    const a = series(wk)[0]!;
    const g = goalSeries(wk)[0]!;
    expect(a.NP).toBe(28); // mission NP actual
    expect(g.NP).toBe(41); // mission NP goal
    expect(Object.keys(g).sort()).toEqual(Object.keys(a).sort());
  });
});
