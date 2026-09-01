/**
 * Seed the identity tables from a real IMOS payload + the Area To Ward Key CSV.
 *
 * Ported from ki-pipeline/crosswalk_seed.py. Given a payload and the CSV it
 * produces every canonical_area / area_crosswalk / area_ward row. On the real
 * 2026-08-24 data this resolves 100% of active areas to a stake
 * (107 areas, 112 ward rows, 11 stakes).
 *
 * Run once at launch for the post-transfer structure; optionally again for a
 * pre-transfer week with an earlier `validFrom` so backfilled weeks resolve.
 */

import { parseCsv } from "./csv.js";
import { NON_WARD_ORG_IDS } from "./constants.js";
import { normName, slug } from "./identity.js";
import { areaActive, iterAreas } from "./readImos.js";
import type { ImosPayload } from "./types.js";

export interface CanonicalAreaRow {
  canonicalAreaKey: string;
  displayName: string;
  createdAt: string;
}
export interface AreaCrosswalkRow {
  imosAreaId: number;
  canonicalAreaKey: string;
  validFrom: string;
  validTo: string | null;
  note: string | null;
}
export interface AreaWardRow {
  canonicalAreaKey: string;
  wardUnitId: number;
  wardName: string;
  stake: string;
  validFrom: string;
  validTo: string | null;
}

export interface SeedResult {
  canonicalAreas: CanonicalAreaRow[];
  areaCrosswalk: AreaCrosswalkRow[];
  areaWard: AreaWardRow[];
  unresolved: string[];
}

export interface AreaKey {
  wardToStake: Map<string, string>;
  areaToWardStake: Map<string, [string, string]>;
}

/**
 * Columns A..C are AREA, WARD, STAKE. Later columns are an unrelated lookup
 * block and are ignored. First value for a given normalised key wins.
 */
export function loadAreaKey(csvText: string): AreaKey {
  const wardToStake = new Map<string, string>();
  const areaToWardStake = new Map<string, [string, string]>();
  const rows = parseCsv(csvText);
  rows.slice(1).forEach((r) => {
    if (r.length < 3) return;
    const area = (r[0] ?? "").trim();
    const ward = (r[1] ?? "").trim();
    const stake = (r[2] ?? "").trim();
    if (!area || !ward || !stake) return;
    const wk = normName(ward);
    if (!wardToStake.has(wk)) wardToStake.set(wk, stake);
    const ak = normName(area);
    if (!areaToWardStake.has(ak)) areaToWardStake.set(ak, [ward, stake]);
  });
  return { wardToStake, areaToWardStake };
}

export function seed(
  payload: ImosPayload,
  areaKey: AreaKey,
  validFrom: string,
): SeedResult {
  const out: SeedResult = {
    canonicalAreas: [],
    areaCrosswalk: [],
    areaWard: [],
    unresolved: [],
  };
  const seenKeys = new Set<string>();

  for (const ctx of iterAreas(payload)) {
    const area = ctx.area;
    if (!areaActive(area)) continue;
    const areaId = area.id;
    const areaName = (area.name ?? "").trim();
    const key = slug(areaName);

    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      out.canonicalAreas.push({ canonicalAreaKey: key, displayName: areaName, createdAt: validFrom });
    }
    out.areaCrosswalk.push({
      imosAreaId: areaId,
      canonicalAreaKey: key,
      validFrom,
      validTo: null,
      note: "seed",
    });

    const areaWs = areaKey.areaToWardStake.get(normName(areaName));
    for (const org of area.entities ?? []) {
      if (org.entityType !== "org" || NON_WARD_ORG_IDS.has(org.id)) continue;
      const wardUnitId = org.id;
      let wardName = (org.name ?? "").trim();
      let stake: string | undefined = areaKey.wardToStake.get(normName(wardName));
      if (stake === undefined && areaWs !== undefined) {
        stake = areaWs[1];
        if (!wardName) wardName = areaWs[0];
      }
      if (stake === undefined) {
        out.unresolved.push(
          `${JSON.stringify(areaName)} (area ${areaId}) ward ${JSON.stringify(wardName)} (unit ${wardUnitId})`,
        );
        continue;
      }
      out.areaWard.push({ canonicalAreaKey: key, wardUnitId, wardName, stake, validFrom, validTo: null });
    }
  }
  return out;
}
