/**
 * Baptism goals: optional monthly and annual targets for the mission and for
 * each zone, and progress against them from the named baptism records.
 *
 * Rules:
 *   - A goal row is (period, zone, goal). period is "YYYY-MM" or "YYYY";
 *     zone "" is the mission.
 *   - The mission goal for a period is the explicit row when there is one,
 *     else the sum of the zone goals for that period when any exist, else none.
 *   - "Actual" counts confirmed-tier named baptisms (the unverified legacy tier
 *     is left out, as everywhere else), de-duplicated the same way the reports are.
 *   - No rows at all means no goals: nothing shows anywhere.
 */

import { dedupeBaptized } from "./friends.js";

export interface GoalRow {
  period: string;
  /** "" for the mission */
  zone: string;
  goal: number;
}

export interface Progress {
  goal: number | null;
  actual: number;
  /** the mission goal was summed from zone goals rather than set directly */
  derived: boolean;
}

export interface PeriodProgress {
  month: Progress;
  year: Progress;
}

export interface GoalProgress {
  /** the month and year measured, YYYY-MM and YYYY */
  month: string;
  year: string;
  mission: PeriodProgress;
  /** every zone that has a goal for the month or the year */
  zones: Record<string, PeriodProgress>;
  /** false when no goal rows exist at all */
  any: boolean;
}

export const MAX_GOAL = 9999;

export function isPeriod(p: unknown): p is string {
  if (typeof p !== "string") return false;
  const m = /^(\d{4})(?:-(\d{2}))?$/.exec(p);
  if (!m) return false;
  if (m[2] !== undefined) {
    const mm = parseInt(m[2], 10);
    if (mm < 1 || mm > 12) return false;
  }
  const y = parseInt(m[1]!, 10);
  return y >= 2000 && y <= 2100;
}

export function isGoalValue(g: unknown): g is number {
  return typeof g === "number" && Number.isInteger(g) && g >= 0 && g <= MAX_GOAL;
}

/** The explicit goal for a period and zone ("" = mission), or null. */
export function goalFor(rows: readonly GoalRow[], period: string, zone: string): number | null {
  const r = rows.find((x) => x.period === period && x.zone === zone);
  return r ? r.goal : null;
}

/** The mission goal: explicit, else the sum of zone goals when any exist. */
export function missionGoal(rows: readonly GoalRow[], period: string): { goal: number | null; derived: boolean } {
  const explicit = goalFor(rows, period, "");
  if (explicit !== null) return { goal: explicit, derived: false };
  const zoneRows = rows.filter((x) => x.period === period && x.zone !== "");
  if (!zoneRows.length) return { goal: null, derived: false };
  return { goal: zoneRows.reduce((s, x) => s + x.goal, 0), derived: true };
}

type BaptizedLike = {
  name: string;
  baptismDate: string | null;
  source: string;
  zone: string | null;
  baptizedConfirmed: boolean;
  confidence: string | null;
};

const confirmedTier = (c: string | null) => c === null || c === "confirmed";

/** De-duplicated confirmed-tier baptisms, ready to count. */
export function countableBaptisms<T extends BaptizedLike>(friends: readonly T[]): T[] {
  return dedupeBaptized(friends.filter((f) => f.baptizedConfirmed && f.baptismDate)).filter((f) =>
    confirmedTier(f.confidence),
  );
}

/**
 * Progress for the month and year that contain `asOf` (YYYY-MM-DD).
 * `friends` is any list of friend records; only confirmed baptisms count.
 */
export function baptismProgress(
  friends: readonly BaptizedLike[],
  rows: readonly GoalRow[],
  asOf: string,
): GoalProgress {
  const month = asOf.slice(0, 7);
  const year = asOf.slice(0, 4);
  const done = countableBaptisms(friends);
  const inMonth = done.filter((f) => f.baptismDate!.startsWith(month));
  const inYear = done.filter((f) => f.baptismDate!.startsWith(year));

  const mission: PeriodProgress = {
    month: { ...missionGoal(rows, month), actual: inMonth.length },
    year: { ...missionGoal(rows, year), actual: inYear.length },
  };

  const zones: Record<string, PeriodProgress> = {};
  const zoneNames = new Set(
    rows.filter((r) => r.zone !== "" && (r.period === month || r.period === year)).map((r) => r.zone),
  );
  for (const z of [...zoneNames].sort()) {
    zones[z] = {
      month: { goal: goalFor(rows, month, z), actual: inMonth.filter((f) => f.zone === z).length, derived: false },
      year: { goal: goalFor(rows, year, z), actual: inYear.filter((f) => f.zone === z).length, derived: false },
    };
  }
  return { month, year, mission, zones, any: rows.length > 0 };
}

/** Mission goal per month, for a chart; null where none. */
export function monthlyMissionGoals(rows: readonly GoalRow[], months: readonly string[]): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const m of months) out[m] = missionGoal(rows, m).goal;
  return out;
}

/**
 * Largest-remainder split of `total` in proportion to `weights`: whole
 * numbers that add up to exactly `total`. Used to turn each zone's share of
 * recent baptisms into suggested zone goals that sum to the mission goal.
 */
export function apportion(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (w / sum) * total);
  const floors = exact.map(Math.floor);
  let left = total - floors.reduce((s, n) => s + n, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i]! += 1;
    left--;
  }
  return floors;
}
