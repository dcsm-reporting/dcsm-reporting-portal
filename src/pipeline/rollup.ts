/**
 * Roll normalised facts up into the tables the boards and reports consume.
 *
 * Ported from ki-pipeline/pipeline/rollup.py. Output shapes are plain nested
 * objects, ready for the API to hand to the UI. Percent is computed here (and
 * also re-derivable at render time); it is never stored.
 *
 * `pyRound` reproduces Python's round-half-to-even so the TypeScript output
 * diffs clean against the Python oracle on all 12 sample weeks. (The old Apps
 * Script decks used round-half-up — a ≤1-point cosmetic difference on exact
 * halves; see STATUS.md reconciliation notes.)
 */

import {
  DEFAULT_ZONE_EXCLUDE,
  KI_CODE,
  KI_IDS,
  MISSION_KEY,
  UNMAPPED_STAKE,
  type KiId,
} from "./constants.js";
import type {
  KiFact,
  KiCell,
  MlcGrid,
  SeriesRow,
  StakeGrid,
  WardFact,
  ZoneGrid,
} from "./types.js";

export { MISSION_KEY, DEFAULT_ZONE_EXCLUDE };

export function pyRound(x: number): number {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff < 0.5) return f;
  if (diff > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

/** Percent of goal, whole number. null when there is no goal (null or 0). */
export function pct(actual: number, goal: number | null): number | null {
  if (!goal) return null; // null or 0
  return pyRound((100 * actual) / goal);
}

interface Bucket {
  goal: number;
  actual: number;
  hasGoal: boolean;
}
function blankKiMap(): Record<number, Bucket> {
  const m: Record<number, Bucket> = {};
  for (const ki of KI_IDS) m[ki] = { goal: 0, actual: 0, hasGoal: false };
  return m;
}
function cellFrom(b: Bucket, ki: KiId): KiCell {
  const goal = b.hasGoal ? b.goal : null;
  return { code: KI_CODE[ki], goal, actual: b.actual, pct: pct(b.actual, goal) };
}

// --- weekly zone / area ---------------------------------------------------
export function byZone(
  facts: Iterable<KiFact>,
  exclude: ReadonlySet<string> = DEFAULT_ZONE_EXCLUDE,
): ZoneGrid {
  const zones = new Map<string, Record<number, Bucket>>();
  const mission = blankKiMap();

  for (const r of facts) {
    if (exclude.has(r.zoneName)) continue;
    let z = zones.get(r.zoneName);
    if (!z) {
      z = blankKiMap();
      zones.set(r.zoneName, z);
    }
    for (const bucket of [z[r.kiId]!, mission[r.kiId]!]) {
      bucket.actual += r.actual;
      if (r.goal !== null) {
        bucket.goal += r.goal;
        bucket.hasGoal = true;
      }
    }
  }

  const result: ZoneGrid = {};
  for (const [name, kimap] of [...zones.entries(), [MISSION_KEY, mission] as const]) {
    result[name] = {};
    for (const ki of KI_IDS) result[name]![ki] = cellFrom(kimap[ki]!, ki);
  }
  return result;
}

export function byArea(facts: Iterable<KiFact>, zoneName: string): ZoneGrid {
  const rows = [...facts].filter((r) => r.zoneName === zoneName);
  const areas = new Map<string, Record<number, Bucket>>();
  for (const r of rows) {
    let a = areas.get(r.areaName);
    if (!a) {
      a = blankKiMap();
      areas.set(r.areaName, a);
    }
    a[r.kiId]!.actual += r.actual;
    if (r.goal !== null) {
      a[r.kiId]!.goal += r.goal;
      a[r.kiId]!.hasGoal = true;
    }
  }

  const out: ZoneGrid = {};
  for (const [name, kimap] of areas) {
    out[name] = {};
    for (const ki of KI_IDS) out[name]![ki] = cellFrom(kimap[ki]!, ki);
  }
  const zoneTotals = byZone(rows)[zoneName];
  if (zoneTotals) out[zoneName.toUpperCase()] = zoneTotals;
  return out;
}

// --- MLC share ----------------------------------------------------------
export function mlc(
  facts: Iterable<KiFact>,
  exclude: ReadonlySet<string> = DEFAULT_ZONE_EXCLUDE,
): MlcGrid {
  const out: MlcGrid = {} as MlcGrid;
  const acc: Record<number, { mission: number; mlc: number }> = {};
  for (const ki of KI_IDS) acc[ki] = { mission: 0, mlc: 0 };

  for (const r of facts) {
    if (exclude.has(r.zoneName)) continue;
    acc[r.kiId]!.mission += r.actual;
    if (r.isMlc) acc[r.kiId]!.mlc += r.actual;
  }
  for (const ki of KI_IDS) {
    const m = acc[ki]!.mission;
    const x = acc[ki]!.mlc;
    out[ki] = {
      code: KI_CODE[ki],
      mission: m,
      mlc: x,
      share: m ? pyRound((100 * x) / m) : null,
    };
  }
  return out;
}

export function mlcAreaIds(facts: Iterable<KiFact>): Set<number> {
  const s = new Set<number>();
  for (const r of facts) if (r.isMlc) s.add(r.areaId);
  return s;
}

// --- monthly ----------------------------------------------------------------
export function monthByZone(
  weekFacts: Iterable<KiFact>[],
  exclude: ReadonlySet<string> = DEFAULT_ZONE_EXCLUDE,
): ZoneGrid {
  const acc = new Map<string, Record<number, Bucket>>();
  for (const facts of weekFacts) {
    const wk = byZone(facts, exclude);
    for (const [name, kimap] of Object.entries(wk)) {
      let dst = acc.get(name);
      if (!dst) {
        dst = blankKiMap();
        acc.set(name, dst);
      }
      for (const ki of KI_IDS) {
        const cell = kimap[ki]!;
        dst[ki]!.actual += cell.actual;
        if (cell.goal !== null) {
          dst[ki]!.goal += cell.goal;
          dst[ki]!.hasGoal = true;
        }
      }
    }
  }
  const out: ZoneGrid = {};
  for (const [name, kimap] of acc) {
    out[name] = {};
    for (const ki of KI_IDS) out[name]![ki] = cellFrom(kimap[ki]!, ki);
  }
  return out;
}

// --- ward / stake ---------------------------------------------------------
export function byStake(
  wardFacts: Iterable<WardFact>,
  wardMap: Map<number, [string, string]>,
): StakeGrid {
  const out: StakeGrid = {};
  for (const w of wardFacts) {
    const mapped = wardMap.get(w.orgId);
    const wardName = mapped ? mapped[0] : w.orgName;
    const stake = mapped ? mapped[1] : UNMAPPED_STAKE;
    let s = out[stake];
    if (!s) {
      s = { wards: {}, total: Object.fromEntries(KI_IDS.map((k) => [k, 0])) };
      out[stake] = s;
    }
    let wd = s.wards[wardName];
    if (!wd) {
      wd = Object.fromEntries(KI_IDS.map((k) => [k, 0]));
      s.wards[wardName] = wd;
    }
    wd[w.kiId] = (wd[w.kiId] ?? 0) + w.actual;
    s.total[w.kiId] = (s.total[w.kiId] ?? 0) + w.actual;
  }
  return out;
}

// --- time series (trends) ------------------------------------------------
export interface WeekFacts {
  label: string;
  weekStart: string;
  facts: KiFact[];
}

function sumActuals(
  facts: Iterable<KiFact>,
  keep: (r: KiFact) => boolean,
): Record<number, number> {
  const tot: Record<number, number> = {};
  for (const ki of KI_IDS) tot[ki] = 0;
  for (const r of facts) {
    if (!keep(r)) continue;
    tot[r.kiId] = (tot[r.kiId] ?? 0) + r.actual;
  }
  return tot;
}

export function series(
  weeks: WeekFacts[],
  opts: { zone?: string | null; mlcOnly?: boolean; exclude?: ReadonlySet<string> } = {},
): SeriesRow[] {
  const exclude = opts.exclude ?? DEFAULT_ZONE_EXCLUDE;
  const zone = opts.zone ?? null;
  const mlcOnly = opts.mlcOnly ?? false;
  const keep = (r: KiFact) => {
    if (exclude.has(r.zoneName)) return false;
    if (zone !== null && r.zoneName !== zone) return false;
    if (mlcOnly && !r.isMlc) return false;
    return true;
  };
  return weeks.map(({ label, weekStart, facts }) => {
    const t = sumActuals(facts, keep);
    return {
      label,
      weekStart,
      BC: t[20]!,
      BD: t[30]!,
      SA: t[40]!,
      NP: t[100]!,
      LMP: t[600]!,
      NMS: t[300]!,
    } satisfies SeriesRow;
  });
}

export interface WeekWardFacts {
  label: string;
  weekStart: string;
  wardFacts: WardFact[];
}

export function stakeSeries(
  weeks: WeekWardFacts[],
  wardMap: Map<number, [string, string]>,
  stake: string,
): SeriesRow[] {
  return weeks.map(({ label, weekStart, wardFacts }) => {
    const s = byStake(wardFacts, wardMap)[stake];
    const t = s ? s.total : (Object.fromEntries(KI_IDS.map((k) => [k, 0])) as Record<number, number>);
    return {
      label,
      weekStart,
      BC: t[20] ?? 0,
      BD: t[30] ?? 0,
      SA: t[40] ?? 0,
      NP: t[100] ?? 0,
      LMP: t[600] ?? 0,
      NMS: t[300] ?? 0,
    } satisfies SeriesRow;
  });
}
