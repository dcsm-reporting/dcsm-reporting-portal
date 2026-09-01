/**
 * Transfer rollover planner — pure.
 *
 * Given a stored week's structure (its IMOS areas and org children) and the
 * current crosswalk, work out what changed and propose how to resolve it:
 * new / retired zones, IMOS area ids with no canonical mapping (each with a
 * best-guess canonical key), and org ids with no ward → stake row (each with a
 * best-guess stake from the Area To Ward Key).
 *
 * The Admin → Rollover screen renders this and lets a person accept the
 * suggestions in bulk. Nothing here writes; `POST /api/rollover/:week/apply`
 * turns accepted rows into crosswalk writes.
 */

import type { AreaCrosswalkRow, AreaKey, AreaWardRow, CanonicalAreaRow } from "./crosswalkSeed.js";
import { normName, slug } from "./identity.js";
import { crosswalkForWeek, wardMapForWeek } from "./resolve.js";

export type Confidence = "high" | "medium" | "low";

export interface RolloverAreaInput {
  imosAreaId: number;
  imosAreaName: string;
  zoneName: string;
}
export interface RolloverOrgInput {
  orgId: number;
  orgName: string;
  imosAreaId: number;
  areaName: string;
}

export interface RolloverInput {
  weekStart: string;
  areas: RolloverAreaInput[];
  orgs: RolloverOrgInput[];
  prevZoneNames: string[] | null;
  crosswalk: AreaCrosswalkRow[];
  areaWard: AreaWardRow[];
  canonical: CanonicalAreaRow[];
  areaKey: AreaKey;
}

export interface ZoneChange {
  name: string;
  status: "unchanged" | "new" | "retired";
  areaCount: number;
}

export interface AreaSuggestion {
  canonicalAreaKey: string;
  displayName: string;
  isNew: boolean;
  reason: string;
  confidence: Confidence;
}
export interface RolloverArea {
  imosAreaId: number;
  imosAreaName: string;
  zoneName: string;
  mapped: boolean;
  currentKey: string | null;
  suggestion: AreaSuggestion | null;
}

export interface WardSuggestion {
  canonicalAreaKey: string | null;
  wardName: string;
  stake: string | null;
  reason: string;
  confidence: Confidence;
}
export interface RolloverWard {
  orgId: number;
  orgName: string;
  imosAreaId: number;
  areaName: string;
  mapped: boolean;
  suggestion: WardSuggestion;
}

export interface RolloverPlan {
  weekStart: string;
  zones: ZoneChange[];
  areas: RolloverArea[];
  wards: RolloverWard[];
  summary: {
    zonesNew: number;
    zonesRetired: number;
    areasUnmapped: number;
    areasSuggested: number;
    wardsUnmapped: number;
    wardsSuggested: number;
    clean: boolean;
  };
}

function suggestArea(
  name: string,
  canonicalByKey: Map<string, CanonicalAreaRow>,
  canonicalByName: Map<string, CanonicalAreaRow>,
  areaKey: AreaKey,
): AreaSuggestion {
  const key = slug(name);
  const byKey = canonicalByKey.get(key);
  if (byKey) {
    return {
      canonicalAreaKey: byKey.canonicalAreaKey,
      displayName: byKey.displayName,
      isNew: false,
      reason: "exact key match to an existing area",
      confidence: "high",
    };
  }
  const byName = canonicalByName.get(normName(name));
  if (byName) {
    return {
      canonicalAreaKey: byName.canonicalAreaKey,
      displayName: byName.displayName,
      isNew: false,
      reason: "name matches an existing area",
      confidence: "high",
    };
  }
  if (areaKey.areaToWardStake.has(normName(name))) {
    return {
      canonicalAreaKey: key,
      displayName: name,
      isNew: true,
      reason: "known in the Area To Ward Key — will create a canonical area",
      confidence: "medium",
    };
  }
  return {
    canonicalAreaKey: key,
    displayName: name,
    isNew: true,
    reason: "new area — will create a canonical area with this key",
    confidence: "low",
  };
}

function suggestWard(
  org: RolloverOrgInput,
  areaMapForWeek: Map<number, string>,
  areaPlanKey: Map<number, string>,
  areaKey: AreaKey,
): WardSuggestion {
  const canonicalAreaKey = areaMapForWeek.get(org.imosAreaId) ?? areaPlanKey.get(org.imosAreaId) ?? null;
  const byWard = areaKey.wardToStake.get(normName(org.orgName));
  if (byWard) {
    return {
      canonicalAreaKey,
      wardName: org.orgName || byWard,
      stake: byWard,
      reason: "ward name found in the Area To Ward Key",
      confidence: "high",
    };
  }
  const byArea = areaKey.areaToWardStake.get(normName(org.areaName));
  if (byArea) {
    return {
      canonicalAreaKey,
      wardName: org.orgName || byArea[0],
      stake: byArea[1],
      reason: "stake taken from the area's row in the Area To Ward Key",
      confidence: "medium",
    };
  }
  return {
    canonicalAreaKey,
    wardName: org.orgName,
    stake: null,
    reason: "no match — set the stake by hand",
    confidence: "low",
  };
}

export function planRollover(input: RolloverInput): RolloverPlan {
  const { weekStart } = input;
  const areaMap = crosswalkForWeek(input.crosswalk, weekStart);
  const wardMap = wardMapForWeek(input.areaWard, weekStart);
  const canonicalByKey = new Map(input.canonical.map((c) => [c.canonicalAreaKey, c]));
  const canonicalByName = new Map(input.canonical.map((c) => [normName(c.displayName), c]));

  // zones
  const thisZones = new Map<string, number>();
  for (const a of input.areas) thisZones.set(a.zoneName, (thisZones.get(a.zoneName) ?? 0) + 1);
  const prev = new Set(input.prevZoneNames ?? []);
  const zones: ZoneChange[] = [];
  for (const [name, areaCount] of thisZones) {
    const status = input.prevZoneNames === null ? "unchanged" : prev.has(name) ? "unchanged" : "new";
    zones.push({ name, status, areaCount });
  }
  if (input.prevZoneNames) {
    for (const name of prev) {
      if (!thisZones.has(name)) zones.push({ name, status: "retired", areaCount: 0 });
    }
  }
  zones.sort((a, b) => a.name.localeCompare(b.name));

  // areas
  const areaPlanKey = new Map<number, string>(); // what each imos area id will resolve to after apply
  const areas: RolloverArea[] = input.areas
    .map((a) => {
      const currentKey = areaMap.get(a.imosAreaId) ?? null;
      if (currentKey) areaPlanKey.set(a.imosAreaId, currentKey);
      const suggestion = currentKey
        ? null
        : suggestArea(a.imosAreaName, canonicalByKey, canonicalByName, input.areaKey);
      if (suggestion) areaPlanKey.set(a.imosAreaId, suggestion.canonicalAreaKey);
      return {
        imosAreaId: a.imosAreaId,
        imosAreaName: a.imosAreaName,
        zoneName: a.zoneName,
        mapped: currentKey !== null,
        currentKey,
        suggestion,
      };
    })
    .sort((x, y) => x.zoneName.localeCompare(y.zoneName) || x.imosAreaName.localeCompare(y.imosAreaName));

  // wards
  const wards: RolloverWard[] = input.orgs
    .map((o) => {
      const mapped = wardMap.has(o.orgId);
      return {
        orgId: o.orgId,
        orgName: o.orgName,
        imosAreaId: o.imosAreaId,
        areaName: o.areaName,
        mapped,
        suggestion: suggestWard(o, areaMap, areaPlanKey, input.areaKey),
      };
    })
    .filter((w) => !w.mapped)
    .sort((x, y) => x.areaName.localeCompare(y.areaName) || x.orgName.localeCompare(y.orgName));

  const areasUnmapped = areas.filter((a) => !a.mapped).length;
  const areasSuggested = areas.filter((a) => a.suggestion && a.suggestion.confidence !== "low").length;
  const wardsSuggested = wards.filter((w) => w.suggestion.stake !== null).length;
  const zonesNew = zones.filter((z) => z.status === "new").length;
  const zonesRetired = zones.filter((z) => z.status === "retired").length;

  return {
    weekStart,
    zones,
    areas,
    wards,
    summary: {
      zonesNew,
      zonesRetired,
      areasUnmapped,
      areasSuggested,
      wardsUnmapped: wards.length,
      wardsSuggested,
      clean: areasUnmapped === 0 && wards.length === 0 && zonesNew === 0 && zonesRetired === 0,
    },
  };
}
