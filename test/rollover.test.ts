import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { normalize } from "../src/pipeline/readImos.js";
import { loadAreaKey, seed } from "../src/pipeline/crosswalkSeed.js";
import { planRollover, type RolloverInput } from "../src/pipeline/rollover.js";
import type { ImosPayload, NormalizeResult } from "../src/pipeline/types.js";

const dir = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const WIDE: [number, number] = [1, 200];
const areaKey = loadAreaKey(readFileSync(dir("../resources/area-to-ward-key.csv"), "utf-8"));

function norm(file: string): NormalizeResult {
  const p = JSON.parse(readFileSync(dir(`../samples/${file}`), "utf-8")) as ImosPayload;
  return normalize(p, { areaBand: WIDE });
}

function structureOf(n: NormalizeResult) {
  const areas = new Map<number, { imosAreaId: number; imosAreaName: string; zoneName: string }>();
  for (const f of n.facts)
    if (!areas.has(f.areaId))
      areas.set(f.areaId, { imosAreaId: f.areaId, imosAreaName: f.areaName, zoneName: f.zoneName });
  const areaName = new Map([...areas.values()].map((a) => [a.imosAreaId, a.imosAreaName]));
  const orgs = new Map<number, RolloverInput["orgs"][number]>();
  for (const w of n.wardFacts)
    if (!orgs.has(w.orgId))
      orgs.set(w.orgId, {
        orgId: w.orgId,
        orgName: w.orgName,
        imosAreaId: w.imosAreaId,
        areaName: areaName.get(w.imosAreaId) ?? "",
      });
  return { areas: [...areas.values()], orgs: [...orgs.values()] };
}

function seededTables(fromFile: string) {
  const payload = JSON.parse(readFileSync(dir(`../samples/${fromFile}`), "utf-8")) as ImosPayload;
  const wk = norm(fromFile).weekStart;
  const s = seed(payload, areaKey, wk);
  return { crosswalk: s.areaCrosswalk, areaWard: s.areaWard, canonical: s.canonicalAreas };
}

describe("planRollover", () => {
  it("a week seeded from itself is clean — nothing to do", () => {
    const n = norm("2026-08-24.json");
    const { areas, orgs } = structureOf(n);
    const plan = planRollover({
      weekStart: n.weekStart,
      areas,
      orgs,
      prevZoneNames: null,
      ...seededTables("2026-08-24.json"),
      areaKey,
    });
    expect(plan.summary.clean).toBe(true);
    expect(plan.summary.areasUnmapped).toBe(0);
    expect(plan.summary.wardsUnmapped).toBe(0);
  });

  it("a later week against an earlier crosswalk surfaces the new structure with suggestions", () => {
    const n = norm("2026-08-24.json");
    const prev = norm("2026-08-17.json");
    const { areas, orgs } = structureOf(n);
    const plan = planRollover({
      weekStart: n.weekStart,
      areas,
      orgs,
      prevZoneNames: [...new Set(prev.facts.map((f) => f.zoneName))],
      ...seededTables("2026-08-17.json"),
      areaKey,
    });

    expect(plan.summary.areasUnmapped).toBeGreaterThan(0);
    // every unmapped area gets a suggestion, and a real slug for its key
    for (const a of plan.areas.filter((x) => !x.mapped)) {
      expect(a.suggestion).not.toBeNull();
      expect(a.suggestion!.canonicalAreaKey).toMatch(/^[a-z0-9-]+$/);
    }
    // most should be high/medium confidence (known names / CSV)
    expect(plan.summary.areasSuggested).toBeGreaterThan(0);
    // zones are stable between 8-17 and 8-24
    expect(plan.summary.zonesNew).toBe(0);
    expect(plan.summary.zonesRetired).toBe(0);
  });

  it("applying every suggestion would fully resolve the week", () => {
    const n = norm("2026-08-24.json");
    const tables = seededTables("2026-08-17.json");
    const { areas, orgs } = structureOf(n);
    const plan = planRollover({
      weekStart: n.weekStart,
      areas,
      orgs,
      prevZoneNames: null,
      ...tables,
      areaKey,
    });

    // simulate apply: add a crosswalk row for every suggested area
    for (const a of plan.areas.filter((x) => !x.mapped && x.suggestion)) {
      tables.crosswalk.push({
        imosAreaId: a.imosAreaId,
        canonicalAreaKey: a.suggestion!.canonicalAreaKey,
        validFrom: n.weekStart,
        validTo: null,
        note: "rollover",
      });
      if (a.suggestion!.isNew)
        tables.canonical.push({
          canonicalAreaKey: a.suggestion!.canonicalAreaKey,
          displayName: a.suggestion!.displayName,
          createdAt: n.weekStart,
        });
    }
    for (const w of plan.wards.filter((x) => x.suggestion.stake && x.suggestion.canonicalAreaKey)) {
      tables.areaWard.push({
        canonicalAreaKey: w.suggestion.canonicalAreaKey!,
        wardUnitId: w.orgId,
        wardName: w.suggestion.wardName,
        stake: w.suggestion.stake!,
        validFrom: n.weekStart,
        validTo: null,
      });
    }

    const after = planRollover({
      weekStart: n.weekStart,
      areas,
      orgs,
      prevZoneNames: null,
      ...tables,
      areaKey,
    });
    expect(after.summary.areasUnmapped).toBe(0);
  });
});
