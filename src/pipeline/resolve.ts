/**
 * Resolve IMOS area ids to the mission's stable identity and to ward/stake.
 *
 * Ported from ki-pipeline/pipeline/resolve.py, but as pure functions over row
 * arrays — the DB layer fetches the crosswalk tables and passes them in, so
 * this file has no platform dependency and is unit-testable on its own.
 *
 * The IMOS area id changes when the mission president adjusts areas. Identity
 * rests on `canonicalAreaKey` (a slug the mission owns, never changes) with an
 * effective-dated crosswalk. Ward → stake is anchored on the org/unit id.
 */

import type { AreaCrosswalkRow, AreaWardRow, CanonicalAreaRow } from "./crosswalkSeed.js";
import type { KiFact } from "./types.js";

function effective<T extends { validFrom: string; validTo: string | null }>(
  rows: readonly T[],
  week: string,
): T[] {
  return rows.filter((r) => r.validFrom <= week && (r.validTo === null || r.validTo > week));
}

/** {imosAreaId → canonicalAreaKey} effective that week. */
export function crosswalkForWeek(
  rows: readonly AreaCrosswalkRow[],
  week: string,
): Map<number, string> {
  const m = new Map<number, string>();
  for (const r of effective(rows, week)) m.set(r.imosAreaId, r.canonicalAreaKey);
  return m;
}

/** {wardUnitId (== IMOS org id) → [wardName, stake]} effective that week. */
export function wardMapForWeek(
  rows: readonly AreaWardRow[],
  week: string,
): Map<number, [string, string]> {
  const m = new Map<number, [string, string]>();
  for (const r of effective(rows, week)) m.set(r.wardUnitId, [r.wardName, r.stake]);
  return m;
}

export function wardsForKey(
  rows: readonly AreaWardRow[],
  key: string,
  week: string,
): { wardUnitId: number; wardName: string; stake: string }[] {
  return effective(rows, week)
    .filter((r) => r.canonicalAreaKey === key)
    .map((r) => ({ wardUnitId: r.wardUnitId, wardName: r.wardName, stake: r.stake }))
    .sort((a, b) => a.wardName.localeCompare(b.wardName));
}

export interface ResolvedArea {
  imosAreaId: number;
  imosAreaName: string;
  canonicalAreaKey: string;
  displayName: string;
  wards: { wardUnitId: number; wardName: string; stake: string }[];
}

export interface ResolveResult {
  weekStart: string;
  resolved: Map<number, ResolvedArea>;
  unmapped: [number, string][];
}

export function resolveWeek(
  facts: readonly KiFact[],
  week: string,
  tables: {
    crosswalk: readonly AreaCrosswalkRow[];
    areaWard: readonly AreaWardRow[];
    canonical: readonly CanonicalAreaRow[];
  },
): ResolveResult {
  const crosswalk = crosswalkForWeek(tables.crosswalk, week);
  const displayName = new Map(tables.canonical.map((c) => [c.canonicalAreaKey, c.displayName]));

  const seen = new Map<number, string>();
  for (const f of facts) if (!seen.has(f.areaId)) seen.set(f.areaId, f.areaName);

  const result: ResolveResult = { weekStart: week, resolved: new Map(), unmapped: [] };
  for (const [areaId, areaName] of seen) {
    const key = crosswalk.get(areaId);
    if (key === undefined) {
      result.unmapped.push([areaId, areaName]);
      continue;
    }
    result.resolved.set(areaId, {
      imosAreaId: areaId,
      imosAreaName: areaName,
      canonicalAreaKey: key,
      displayName: displayName.get(key) ?? key,
      wards: wardsForKey(tables.areaWard, key, week),
    });
  }
  return result;
}
