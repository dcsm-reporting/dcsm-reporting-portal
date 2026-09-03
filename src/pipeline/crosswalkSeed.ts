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
  /** normalised ward name → stake (portal spelling) */
  wardToStake: Map<string, string>;
  /** normalised area name → [ward, stake] */
  areaToWardStake: Map<string, [string, string]>;
}

/** Ward name as a lookup key: no parenthetical, no trailing Ward/Branch. */
export function wardKey(name: string): string {
  return normName(
    String(name ?? "")
      .replace(/\([^)]*\)/g, " ")
      .replace(/\s+(ward|branch)\s*$/i, " "),
  );
}

/** "Annandale Virginia Stake" → "Annandale"; the YSA stake gets its portal name. */
const STAKE_ALIASES: Record<string, string> = { "washington dc ysa south": "WDCS YSA" };
export function portalStakeName(s: string): string {
  const stripped = String(s ?? "")
    .replace(/\s+virginia\s+stake\s*$/i, "")
    .replace(/\s+stake\s*$/i, "")
    .trim();
  return STAKE_ALIASES[stripped.toLowerCase()] ?? stripped;
}

/**
 * Columns A..C are AREA, WARD, STAKE. Later columns are an unrelated lookup
 * block and are ignored. First value for a given normalised key wins.
 *
 * `unitsCsv` (optional) is the mission's unit directory —
 * `unit_id,unit_name,type,stake,city` — used as a second ward-name → stake
 * lookup for wards the Area To Ward Key never listed. Its ids are the Church's
 * CDOL unit numbers, *not* the IMOS org ids, so it can only help by name.
 */
export function loadAreaKey(csvText: string, unitsCsv?: string): AreaKey {
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
    const wk2 = wardKey(ward);
    if (!wardToStake.has(wk2)) wardToStake.set(wk2, stake);
    const ak = normName(area);
    if (!areaToWardStake.has(ak)) areaToWardStake.set(ak, [ward, stake]);
  });
  if (unitsCsv) {
    const urows = parseCsv(unitsCsv);
    const hdr = (urows[0] ?? []).map((h) => h.trim().toLowerCase());
    const iName = hdr.indexOf("unit_name");
    const iStake = hdr.indexOf("stake");
    if (iName >= 0 && iStake >= 0) {
      for (const r of urows.slice(1)) {
        const name = (r[iName] ?? "").trim();
        const stake = portalStakeName(r[iStake] ?? "");
        if (!name || !stake) continue;
        const k = wardKey(name);
        if (k && !wardToStake.has(k)) wardToStake.set(k, stake);
      }
    }
  }
  return { wardToStake, areaToWardStake };
}

/** Look a ward name up in the key, trying the exact and the stripped form. */
export function stakeForWardName(areaKey: AreaKey, name: string): string | undefined {
  return areaKey.wardToStake.get(normName(name)) ?? areaKey.wardToStake.get(wardKey(name));
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
      let stake: string | undefined = stakeForWardName(areaKey, wardName);
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
