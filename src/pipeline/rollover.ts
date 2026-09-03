/**
 * Transfer rollover planner — pure.
 *
 * Given a stored week's structure (its IMOS areas and org children) and the
 * current crosswalk, work out what changed and propose how to resolve it:
 * new / retired zones, IMOS area ids with no canonical mapping (each with a
 * best-guess canonical key), org ids with no ward → stake row (each with a
 * best-guess stake), and mapped areas that have vanished from IMOS (each
 * proposed for closing / retiring).
 *
 * The Admin → Rollover screen renders this and lets a person accept the
 * suggestions in bulk. Nothing here writes; `POST /api/rollover/:week/apply`
 * turns accepted rows into crosswalk writes.
 */

import { stakeForWardName, type AreaCrosswalkRow, type AreaKey, type AreaWardRow, type CanonicalAreaRow } from "./crosswalkSeed.js";
import { wardKey } from "./crosswalkSeed.js";
import { normName, slug } from "./identity.js";
import { crosswalkStrictForWeek, wardMapForWeek, wardMapStrictForWeek } from "./resolve.js";

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
  /** IMOS area ids present in the immediately-prior stored week (null if none). */
  prevAreaIds: number[] | null;
  crosswalk: AreaCrosswalkRow[];
  areaWard: AreaWardRow[];
  canonical: CanonicalAreaRow[];
  areaKey: AreaKey;
  /** zones the config excludes from mission totals (to flag a stale entry) */
  zoneExclude?: string[];
  /** configured zone display order (to propose an update) */
  zoneOrder?: string[];
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
  /** Appears this week but not in the prior stored week — a split/new area. */
  newThisWeek: boolean;
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

/** A mapped IMOS area id that no longer appears in this week's report. */
export interface RolloverVanished {
  imosAreaId: number;
  canonicalAreaKey: string;
  displayName: string;
  validFrom: string;
  /** other open mappings for the same canonical key (a split / a rename with a new id) */
  otherOpenMappings: number;
  /** true when closing this mapping leaves the canonical area with no open id → retire it */
  wouldRetire: boolean;
}

export interface RolloverPlan {
  weekStart: string;
  zones: ZoneChange[];
  areas: RolloverArea[];
  wards: RolloverWard[];
  vanished: RolloverVanished[];
  /** configured excluded zones that are not in this week's report at all */
  excludedZonesMissing: string[];
  /** the configured zone order with retired zones dropped and new ones appended */
  zoneOrderSuggested: string[] | null;
  summary: {
    zonesNew: number;
    zonesRetired: number;
    areasUnmapped: number;
    areasSuggested: number;
    areasNew: number;
    areasVanished: number;
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

interface WardContext {
  /** every ward row ever stored, any key, any date */
  allWardRows: readonly AreaWardRow[];
  /** org id → stake for orgs that are mapped this week */
  wardMap: Map<number, [string, string]>;
  /** imos area id → org ids in it this week */
  orgsByArea: Map<number, number[]>;
}

function suggestWard(
  org: RolloverOrgInput,
  areaMapForWeek: Map<number, string>,
  areaPlanKey: Map<number, string>,
  areaKey: AreaKey,
  ctx: WardContext,
): WardSuggestion {
  const canonicalAreaKey = areaMapForWeek.get(org.imosAreaId) ?? areaPlanKey.get(org.imosAreaId) ?? null;
  const name = org.orgName;

  // 1. the same IMOS org id was mapped before, under any area — most reliable
  const priorById = ctx.allWardRows
    .filter((r) => r.wardUnitId === org.orgId)
    .sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];
  if (priorById) {
    return {
      canonicalAreaKey,
      wardName: name || priorById.wardName,
      stake: priorById.stake,
      reason: `this ward (org #${org.orgId}) was mapped to ${priorById.stake} before`,
      confidence: "high",
    };
  }
  // 2. a ward with this name was mapped before (renumbered unit, same ward)
  const priorByName = name
    ? ctx.allWardRows
        .filter((r) => wardKey(r.wardName) === wardKey(name))
        .sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0]
    : undefined;
  if (priorByName) {
    return {
      canonicalAreaKey,
      wardName: name,
      stake: priorByName.stake,
      reason: `a ward named "${priorByName.wardName}" is mapped to ${priorByName.stake}`,
      confidence: "high",
    };
  }
  // 3. the bundled Area To Ward Key / unit directory knows the name
  const byWard = name ? stakeForWardName(areaKey, name) : undefined;
  if (byWard) {
    return {
      canonicalAreaKey,
      wardName: name || byWard,
      stake: byWard,
      reason: "ward name found in the Area To Ward Key / unit directory",
      confidence: "high",
    };
  }
  // 4. a sibling ward in the same IMOS area is already mapped — same stake very likely
  const sibling = (ctx.orgsByArea.get(org.imosAreaId) ?? [])
    .filter((id) => id !== org.orgId)
    .map((id) => ctx.wardMap.get(id))
    .find((x): x is [string, string] => !!x);
  if (sibling) {
    return {
      canonicalAreaKey,
      wardName: name,
      stake: sibling[1],
      reason: `the other ward in this area (${sibling[0]}) is in ${sibling[1]}`,
      confidence: "medium",
    };
  }
  // 5. the area's own row in the Area To Ward Key
  const byArea = areaKey.areaToWardStake.get(normName(org.areaName));
  if (byArea) {
    return {
      canonicalAreaKey,
      wardName: name || byArea[0],
      stake: byArea[1],
      reason: "stake taken from the area's row in the Area To Ward Key",
      confidence: "medium",
    };
  }
  return {
    canonicalAreaKey,
    wardName: name,
    stake: null,
    reason: "no match — set the stake by hand",
    confidence: "low",
  };
}

export function planRollover(input: RolloverInput): RolloverPlan {
  const { weekStart } = input;
  // strict: only mappings whose dates actually cover this week count as "mapped" here —
  // the point of Rollover is to make the dated record explicit for this week
  const areaMap = crosswalkStrictForWeek(input.crosswalk, weekStart);
  // strict for "is this ward mapped for this week"; the fallback map (any
  // nearest row) feeds the sibling suggestion so a paused ward still helps
  const wardMapStrict = wardMapStrictForWeek(input.areaWard, weekStart);
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

  // only a zone that *was* in the previous week and is now gone is worth a
  // warning; an excluded zone that has never had active areas is just quiet
  const excludedZonesMissing = (input.zoneExclude ?? []).filter(
    (z) => !thisZones.has(z) && (input.prevZoneNames ?? []).includes(z),
  );
  let zoneOrderSuggested: string[] | null = null;
  if (input.zoneOrder) {
    const kept = input.zoneOrder.filter((z) => thisZones.has(z) || (input.zoneExclude ?? []).includes(z));
    const added = [...thisZones.keys()].filter((z) => !kept.includes(z)).sort();
    const next = [...kept, ...added];
    if (next.join("|") !== input.zoneOrder.join("|")) zoneOrderSuggested = next;
  }

  // areas
  const prevAreas = input.prevAreaIds === null ? null : new Set(input.prevAreaIds);
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
        newThisWeek: prevAreas !== null && !prevAreas.has(a.imosAreaId),
        currentKey,
        suggestion,
      };
    })
    .sort((x, y) => x.zoneName.localeCompare(y.zoneName) || x.imosAreaName.localeCompare(y.imosAreaName));

  // vanished: open mappings (effective this week) whose id is not in the report
  const thisAreaIds = new Set(input.areas.map((a) => a.imosAreaId));
  const openRows = input.crosswalk.filter((r) => r.validTo === null && r.validFrom <= weekStart);
  const openByKey = new Map<string, number>();
  for (const r of openRows) openByKey.set(r.canonicalAreaKey, (openByKey.get(r.canonicalAreaKey) ?? 0) + 1);
  const vanished: RolloverVanished[] = openRows
    .filter((r) => !thisAreaIds.has(r.imosAreaId))
    .map((r) => {
      const others = (openByKey.get(r.canonicalAreaKey) ?? 1) - 1;
      // an id in this plan's suggestions pointing at the same key counts as a successor
      const successor = areas.some(
        (a) => !a.mapped && a.suggestion?.canonicalAreaKey === r.canonicalAreaKey && !a.suggestion.isNew,
      );
      return {
        imosAreaId: r.imosAreaId,
        canonicalAreaKey: r.canonicalAreaKey,
        displayName: canonicalByKey.get(r.canonicalAreaKey)?.displayName ?? r.canonicalAreaKey,
        validFrom: r.validFrom,
        otherOpenMappings: others,
        wouldRetire: others === 0 && !successor,
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  // wards
  const orgsByArea = new Map<number, number[]>();
  for (const o of input.orgs) {
    const l = orgsByArea.get(o.imosAreaId);
    if (l) l.push(o.orgId);
    else orgsByArea.set(o.imosAreaId, [o.orgId]);
  }
  const ctx: WardContext = { allWardRows: input.areaWard, wardMap, orgsByArea };
  const wards: RolloverWard[] = input.orgs
    .map((o) => {
      const mapped = wardMapStrict.has(o.orgId);
      return {
        orgId: o.orgId,
        orgName: o.orgName,
        imosAreaId: o.imosAreaId,
        areaName: o.areaName,
        mapped,
        suggestion: suggestWard(o, areaMap, areaPlanKey, input.areaKey, ctx),
      };
    })
    .filter((w) => !w.mapped)
    .sort((x, y) => x.areaName.localeCompare(y.areaName) || x.orgName.localeCompare(y.orgName));

  const areasUnmapped = areas.filter((a) => !a.mapped).length;
  const areasNew = areas.filter((a) => a.newThisWeek).length;
  const areasSuggested = areas.filter((a) => a.suggestion && a.suggestion.confidence !== "low").length;
  const wardsSuggested = wards.filter((w) => w.suggestion.stake !== null).length;
  const zonesNew = zones.filter((z) => z.status === "new").length;
  const zonesRetired = zones.filter((z) => z.status === "retired").length;

  return {
    weekStart,
    zones,
    areas,
    wards,
    vanished,
    excludedZonesMissing,
    zoneOrderSuggested,
    summary: {
      zonesNew,
      zonesRetired,
      areasUnmapped,
      areasSuggested,
      areasNew,
      areasVanished: vanished.length,
      wardsUnmapped: wards.length,
      wardsSuggested,
      // zone changes are informational (boards follow the report on their
      // own); only things that need a person's decision block "clean"
      clean:
        areasUnmapped === 0 &&
        wards.length === 0 &&
        vanished.length === 0 &&
        excludedZonesMissing.length === 0,
    },
  };
}
