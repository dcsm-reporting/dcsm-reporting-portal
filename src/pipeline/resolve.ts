/**
 * Resolve IMOS area ids to the mission's stable identity and to ward/stake.
 *
 * Ported from ki-pipeline/pipeline/resolve.py, but as pure functions over row
 * arrays — the DB layer fetches the crosswalk tables and passes them in, so
 * this file has no platform dependency and is unit-testable on its own.
 *
 * The IMOS area id changes when the mission president adjusts areas. Identity
 * rests on `canonicalAreaKey` (a slug the mission owns, never changes) with an
 * effective-dated crosswalk. Ward → stake is anchored on the IMOS org id.
 *
 * Effective dating with a fallback: a row whose date range covers the week
 * always wins. When no row covers the week, the nearest row for that id is
 * used — the one that starts soonest after the week, else the last one that
 * ended before it. That is what makes weeks imported *before* the crosswalk
 * was first seeded resolve, and keeps a ward's stake known in a week where no
 * area happened to cover it. An id is only ever "unmapped" when the mission has
 * never mapped it at all.
 */

import type { AreaCrosswalkRow, AreaWardRow, CanonicalAreaRow } from "./crosswalkSeed.js";
import type { KiFact } from "./types.js";

type Dated = { validFrom: string; validTo: string | null };

function covers(r: Dated, week: string): boolean {
  return r.validFrom <= week && (r.validTo === null || r.validTo > week);
}

function effective<T extends Dated>(rows: readonly T[], week: string): T[] {
  return rows.filter((r) => covers(r, week));
}

/**
 * For each id, the row covering `week`; else the nearest one (soonest later
 * start, else latest earlier row). Returns one row per id.
 */
function effectiveOrNearest<T extends Dated>(
  rows: readonly T[],
  week: string,
  idOf: (r: T) => number,
): Map<number, T> {
  const byId = new Map<number, T[]>();
  for (const r of rows) {
    const list = byId.get(idOf(r));
    if (list) list.push(r);
    else byId.set(idOf(r), [r]);
  }
  const out = new Map<number, T>();
  for (const [id, list] of byId) {
    const hit = list.filter((r) => covers(r, week)).sort((a, b) => b.validFrom.localeCompare(a.validFrom));
    if (hit.length) {
      out.set(id, hit[0]!);
      continue;
    }
    const later = list.filter((r) => r.validFrom > week).sort((a, b) => a.validFrom.localeCompare(b.validFrom));
    if (later.length) {
      out.set(id, later[0]!);
      continue;
    }
    const earlier = list
      .filter((r) => r.validFrom <= week)
      .sort((a, b) => (b.validTo ?? "9999").localeCompare(a.validTo ?? "9999") || b.validFrom.localeCompare(a.validFrom));
    if (earlier.length) out.set(id, earlier[0]!);
  }
  return out;
}

/** {imosAreaId → canonicalAreaKey} for that week (effective, else nearest). */
export function crosswalkForWeek(
  rows: readonly AreaCrosswalkRow[],
  week: string,
): Map<number, string> {
  const m = new Map<number, string>();
  for (const [id, r] of effectiveOrNearest(rows, week, (r) => r.imosAreaId)) m.set(id, r.canonicalAreaKey);
  return m;
}

/** Only the rows whose date range actually covers the week — no fallback. */
export function crosswalkStrictForWeek(
  rows: readonly AreaCrosswalkRow[],
  week: string,
): Map<number, string> {
  const m = new Map<number, string>();
  for (const r of effective(rows, week)) m.set(r.imosAreaId, r.canonicalAreaKey);
  return m;
}

/** {wardUnitId (== IMOS org id) → [wardName, stake]} for that week (effective, else nearest). */
export function wardMapForWeek(
  rows: readonly AreaWardRow[],
  week: string,
): Map<number, [string, string]> {
  const m = new Map<number, [string, string]>();
  for (const [id, r] of effectiveOrNearest(rows, week, (r) => r.wardUnitId)) m.set(id, [r.wardName, r.stake]);
  return m;
}

/** Only ward rows whose date range covers the week — no fallback (Rollover uses this). */
export function wardMapStrictForWeek(
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
