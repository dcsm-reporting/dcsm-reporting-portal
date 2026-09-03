import { describe, expect, it } from "vitest";
import { crosswalkForWeek, crosswalkStrictForWeek, wardMapForWeek } from "../src/pipeline/resolve.js";
import { loadAreaKey, portalStakeName, stakeForWardName, wardKey } from "../src/pipeline/crosswalkSeed.js";
import { planRollover } from "../src/pipeline/rollover.js";

const xw = (imosAreaId: number, key: string, validFrom: string, validTo: string | null = null) => ({
  imosAreaId,
  canonicalAreaKey: key,
  validFrom,
  validTo,
  note: null,
});
const aw = (unit: number, key: string, ward: string, stake: string, validFrom: string, validTo: string | null = null) => ({
  canonicalAreaKey: key,
  wardUnitId: unit,
  wardName: ward,
  stake,
  validFrom,
  validTo,
});

describe("effective-dated lookups fall back to the nearest row", () => {
  it("a week before the first seed still resolves (the production case)", () => {
    const rows = [xw(1, "fairfax", "2026-08-24")];
    expect(crosswalkForWeek(rows, "2026-06-01").get(1)).toBe("fairfax");
    expect(crosswalkStrictForWeek(rows, "2026-06-01").get(1)).toBeUndefined();
    expect(crosswalkForWeek(rows, "2026-08-24").get(1)).toBe("fairfax");
  });

  it("a covering row always wins over a nearer-but-not-covering one", () => {
    const rows = [xw(1, "old-key", "2026-06-01", "2026-08-24"), xw(1, "new-key", "2026-08-24")];
    expect(crosswalkForWeek(rows, "2026-07-06").get(1)).toBe("old-key");
    expect(crosswalkForWeek(rows, "2026-08-24").get(1)).toBe("new-key");
    expect(crosswalkForWeek(rows, "2026-09-07").get(1)).toBe("new-key");
  });

  it("after every row has closed, the last one applies (the id came back)", () => {
    const rows = [xw(1, "tysons", "2026-06-01", "2026-07-13")];
    expect(crosswalkForWeek(rows, "2026-09-07").get(1)).toBe("tysons");
  });

  it("ward → stake is keyed on the unit, whatever area covered it", () => {
    const rows = [
      aw(18650, "fairfax-a", "Fairfax", "Annandale", "2026-08-24"),
      aw(18650, "fairfax-b", "Fairfax", "Annandale", "2026-08-24"),
      aw(4075664, "tysons", "Tysons", "McLean", "2026-06-01", "2026-07-13"),
    ];
    expect(wardMapForWeek(rows, "2026-06-01").get(18650)).toEqual(["Fairfax", "Annandale"]);
    // Tysons ward stays known after its area closed
    expect(wardMapForWeek(rows, "2026-08-24").get(4075664)).toEqual(["Tysons", "McLean"]);
    expect(wardMapForWeek(rows, "2026-08-24").has(99999)).toBe(false);
  });
});

describe("unit directory + ward-name keys", () => {
  it("normalises unit and stake names to the portal's spelling", () => {
    expect(wardKey("Falls Church 2nd (Persian) Ward")).toBe(wardKey("Falls Church 2nd"));
    expect(wardKey("Bull Run YSA Ward")).toBe(wardKey("Bull Run YSA"));
    expect(portalStakeName("Annandale Virginia Stake")).toBe("Annandale");
    expect(portalStakeName("Washington DC YSA South Stake")).toBe("WDCS YSA");
  });

  it("loadAreaKey merges the unit directory as a fallback by name", () => {
    const areaCsv = "AREA,WARD,STAKE\nFairfax,Fairfax,Annandale\n";
    const unitsCsv = "unit_id,unit_name,type,stake,city\n1,Fairfax Ward,Ward,Somewhere Else Stake,X\n2,Goose Creek Ward,Ward,Leesburg Virginia Stake,Y\n";
    const key = loadAreaKey(areaCsv, unitsCsv);
    expect(stakeForWardName(key, "Fairfax")).toBe("Annandale"); // Area To Ward Key wins
    expect(stakeForWardName(key, "Goose Creek")).toBe("Leesburg"); // directory fills the gap
    expect(stakeForWardName(key, "Nowhere")).toBeUndefined();
  });
});

describe("planRollover: vanished areas and ward suggestions from history", () => {
  const areaKey = loadAreaKey("AREA,WARD,STAKE\n");
  const canonical = [
    { canonicalAreaKey: "tysons", displayName: "Tysons", createdAt: "2026-06-01" },
    { canonicalAreaKey: "fairfax", displayName: "Fairfax", createdAt: "2026-06-01" },
  ];

  it("an open mapping whose id is absent this week is proposed for closing / retiring", () => {
    const plan = planRollover({
      weekStart: "2026-07-13",
      areas: [{ imosAreaId: 2, imosAreaName: "Fairfax", zoneName: "Annandale" }],
      orgs: [],
      prevZoneNames: ["Annandale", "McLean"],
      prevAreaIds: [1, 2],
      crosswalk: [xw(1, "tysons", "2026-06-01"), xw(2, "fairfax", "2026-06-01")],
      areaWard: [],
      canonical,
      areaKey,
    });
    expect(plan.vanished).toHaveLength(1);
    expect(plan.vanished[0]).toMatchObject({ imosAreaId: 1, canonicalAreaKey: "tysons", wouldRetire: true });
    expect(plan.summary.clean).toBe(false);
    expect(plan.zones.find((z) => z.name === "McLean")?.status).toBe("retired");
  });

  it("a renamed area under a new id is a successor, not a retirement", () => {
    const plan = planRollover({
      weekStart: "2026-08-24",
      areas: [{ imosAreaId: 9, imosAreaName: "Fairfax", zoneName: "Annandale" }],
      orgs: [],
      prevZoneNames: null,
      prevAreaIds: null,
      crosswalk: [xw(2, "fairfax", "2026-06-01")],
      areaWard: [],
      canonical,
      areaKey,
    });
    expect(plan.areas[0]!.suggestion).toMatchObject({ canonicalAreaKey: "fairfax", isNew: false });
    expect(plan.vanished[0]).toMatchObject({ imosAreaId: 2, wouldRetire: false });
  });

  it("ward suggestions come from history first, then siblings", () => {
    const plan = planRollover({
      weekStart: "2026-08-24",
      areas: [
        { imosAreaId: 2, imosAreaName: "Fairfax", zoneName: "Annandale" },
        { imosAreaId: 3, imosAreaName: "Reston B", zoneName: "Oakton" },
      ],
      orgs: [
        { orgId: 4075664, orgName: "Tysons", imosAreaId: 2, areaName: "Fairfax" }, // seen before, closed
        { orgId: 555, orgName: "Reston 2nd", imosAreaId: 3, areaName: "Reston B" }, // sibling mapped
        { orgId: 20058, orgName: "Reston", imosAreaId: 3, areaName: "Reston B" },
        { orgId: 777, orgName: "Brand New", imosAreaId: 2, areaName: "Fairfax" }, // unknown; its sibling Tysons last resolved to McLean → medium
        { orgId: 888, orgName: "Nowhere Ward", imosAreaId: 42, areaName: "Lonely" }, // unknown, alone → low
      ],
      prevZoneNames: null,
      prevAreaIds: null,
      crosswalk: [xw(2, "fairfax", "2026-06-01"), xw(3, "reston-b", "2026-06-01")],
      areaWard: [
        aw(4075664, "tysons", "Tysons", "McLean", "2026-06-01", "2026-07-13"),
        aw(20058, "reston-b", "Reston", "Oakton", "2026-06-01"),
      ],
      canonical: [...canonical, { canonicalAreaKey: "reston-b", displayName: "Reston B", createdAt: "2026-06-01" }],
      areaKey,
    });
    const byOrg = Object.fromEntries(plan.wards.map((w) => [w.orgId, w.suggestion]));
    expect(byOrg[4075664]).toMatchObject({ stake: "McLean", confidence: "high" });
    expect(byOrg[555]).toMatchObject({ stake: "Oakton", confidence: "medium" });
    expect(byOrg[777]).toMatchObject({ stake: "McLean", confidence: "medium" });
    expect(byOrg[888]).toMatchObject({ stake: null, confidence: "low" });
    expect(byOrg[20058]).toBeUndefined(); // already mapped
  });
});
