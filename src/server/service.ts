/**
 * Assemble the views the UI consumes from stored facts + the crosswalk.
 * Ports ki-pipeline/pipeline/service.py (build_grids / trend) — same window
 * rules, same labels.
 */

import {
  byArea,
  byStake,
  byZone,
  mlc,
  monthByZone,
  series,
  stakeSeries,
  type WeekFacts,
  type WeekWardFacts,
} from "../pipeline/rollup.js";
import { resolveWeek, wardMapForWeek } from "../pipeline/resolve.js";
import { ZONE_ORDER, MISSION_KEY } from "../pipeline/constants.js";
import type { KiFact } from "../pipeline/types.js";
import {
  getAreaWardRows,
  getCanonicalRows,
  getCrosswalkRows,
  loadAreaHistory,
  loadFacts,
  loadWardFacts,
  weeksAvailable,
} from "./db.js";

export function weekLabel(weekStart: string): string {
  const [, m, d] = weekStart.split("-").map((x) => parseInt(x, 10));
  return `Week of ${m}/${d}`;
}

export function periodLabel(weekStarts: string[]): string {
  const months = new Map<string, number>();
  for (const w of weekStarts) {
    const [y, m] = w.split("-");
    const key = `${y}-${m}`;
    months.set(key, (months.get(key) ?? 0) + 1);
  }
  let best = "";
  let bestN = -1;
  for (const [k, n] of months) if (n > bestN) ((best = k), (bestN = n));
  const [y, m] = best.split("-").map((x) => parseInt(x, 10));
  const name = new Date(Date.UTC(y!, m! - 1, 1)).toLocaleString("en-US", {
    month: "long",
    timeZone: "UTC",
  });
  return `${name} ${y}`;
}

function recentWeeks(all: string[], upTo: string, n: number): string[] {
  return all.filter((w) => w <= upTo).slice(-n);
}

/** Zones present in the grid, in board order (known zones first, then extras). */
export function orderedZones(names: Iterable<string>): string[] {
  const present = new Set(names);
  const known = ZONE_ORDER.filter((z) => present.has(z));
  const extra = [...present]
    .filter((n) => !ZONE_ORDER.includes(n) && n !== MISSION_KEY)
    .sort();
  return [...known, ...extra];
}

export async function buildWeekView(db: D1Database, weekStart: string) {
  const facts = await loadFacts(db, weekStart);
  if (facts.length === 0) throw new Error(`no facts stored for week ${weekStart}`);

  const all = await weeksAvailable(db);
  const window = recentWeeks(all, weekStart, 4);
  const monthWeekFacts: KiFact[][] = [];
  for (const w of window) monthWeekFacts.push(w === weekStart ? facts : await loadFacts(db, w));

  const priorWeeks = all.filter((w) => w < weekStart);
  const lastFacts = priorWeeks.length
    ? await loadFacts(db, priorWeeks[priorWeeks.length - 1]!)
    : null;

  const [crosswalk, canonical] = await Promise.all([getCrosswalkRows(db), getCanonicalRows(db)]);
  const areaWard = await getAreaWardRows(db);
  const rr = resolveWeek(facts, weekStart, { crosswalk, areaWard, canonical });

  const zGrid = byZone(facts);
  const zones = orderedZones(Object.keys(zGrid));

  return {
    weekStart,
    weekLabel: weekLabel(weekStart),
    generatedAt: new Date().toISOString(),
    zones,
    byZone: zGrid,
    byArea: Object.fromEntries(zones.map((z) => [z, byArea(facts, z)])),
    mlc: {
      this: mlc(facts),
      last: lastFacts ? mlc(lastFacts) : null,
      lastWeekStart: priorWeeks[priorWeeks.length - 1] ?? null,
    },
    month: {
      byZone: monthByZone(monthWeekFacts),
      window,
      label: periodLabel(window),
    },
    resolve: {
      resolvedCount: rr.resolved.size,
      unmapped: rr.unmapped.map(([id, name]) => ({ imosAreaId: id, imosAreaName: name })),
    },
  };
}

export async function buildTrends(
  db: D1Database,
  opts: { upTo?: string; n?: number; zone?: string | null; mlcOnly?: boolean } = {},
) {
  const all = await weeksAvailable(db);
  const upTo = opts.upTo ?? all[all.length - 1] ?? "";
  const n = opts.n ?? 12;
  const weeks = recentWeeks(all, upTo, n);
  const wf: WeekFacts[] = [];
  for (const w of weeks) wf.push({ label: weekLabel(w), weekStart: w, facts: await loadFacts(db, w) });
  return series(wf, { zone: opts.zone ?? null, mlcOnly: opts.mlcOnly ?? false });
}

export async function buildStakeView(db: D1Database, weekStart: string, windowN = 12) {
  const all = await weeksAvailable(db);
  const areaWard = await getAreaWardRows(db);
  const wardMap = wardMapForWeek(areaWard, weekStart);

  const thisWard = await loadWardFacts(db, weekStart);
  const grid = byStake(thisWard, wardMap);

  const weeks = recentWeeks(all, weekStart, windowN);
  const wf: WeekWardFacts[] = [];
  for (const w of weeks)
    wf.push({ label: weekLabel(w), weekStart: w, wardFacts: await loadWardFacts(db, w) });

  const stakes = Object.keys(grid).sort();
  const seriesByStake = Object.fromEntries(
    stakes.map((s) => [s, stakeSeries(wf, wardMap, s)]),
  );

  return {
    weekStart,
    weekLabel: weekLabel(weekStart),
    wardMapSize: wardMap.size,
    stakes,
    byStake: grid,
    stakeSeries: seriesByStake,
  };
}

export async function buildChase(db: D1Database, weekStart: string) {
  const [history, facts] = await Promise.all([
    loadAreaHistory(db, weekStart),
    loadFacts(db, weekStart),
  ]);
  const zoneOf = new Map<number, string>();
  for (const f of facts) if (!zoneOf.has(f.areaId)) zoneOf.set(f.areaId, f.zoneName);

  const stale = history
    .filter((h) => !h.updatedThisWeek)
    .map((h) => ({
      imosAreaId: h.imosAreaId,
      areaName: h.imosAreaName,
      zoneName: zoneOf.get(h.imosAreaId) ?? "",
      lastModified: h.modifiedDate,
    }))
    .sort((a, b) => a.zoneName.localeCompare(b.zoneName) || a.areaName.localeCompare(b.areaName));

  return { weekStart, weekLabel: weekLabel(weekStart), count: stale.length, areas: stale };
}
