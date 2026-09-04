/**
 * Baptism goals: storage and the views built on src/pipeline/goals.ts.
 * Optional throughout: with no rows, every caller gets "no goal" and shows nothing.
 */

import {
  baptismProgress,
  countableBaptisms,
  isGoalValue,
  isPeriod,
  monthlyMissionGoals,
  type GoalProgress,
  type GoalRow,
} from "../pipeline/goals.js";
import { todayIso } from "../shared/dates.js";
import { listFriends } from "./friends.js";

export async function listGoalRows(db: D1Database, yearPrefix?: string): Promise<GoalRow[]> {
  const sql = yearPrefix
    ? "SELECT period, zone, goal FROM baptism_goal WHERE period LIKE ? ORDER BY period, zone"
    : "SELECT period, zone, goal FROM baptism_goal ORDER BY period, zone";
  const stmt = yearPrefix ? db.prepare(sql).bind(`${yearPrefix}%`) : db.prepare(sql);
  const { results } = await stmt.all<{ period: string; zone: string; goal: number }>();
  return (results ?? []).map((r) => ({ period: r.period, zone: r.zone, goal: r.goal }));
}

export interface GoalEntry {
  period: string;
  /** "" or absent = mission */
  zone?: string | null;
  /** null or absent = remove the goal */
  goal?: number | null;
}

/** Upsert or remove goal rows. Throws on a bad period or value; writes nothing then. */
export async function setGoalRows(
  db: D1Database,
  user: string,
  entries: GoalEntry[],
): Promise<{ written: number; removed: number }> {
  if (!Array.isArray(entries) || entries.length > 400) throw new Error("entries[] required (at most 400)");
  const now = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [];
  let written = 0;
  let removed = 0;
  const seen = new Set<string>();
  for (const e of entries) {
    if (!isPeriod(e.period)) throw new Error(`bad period "${String(e.period)}" (use YYYY-MM or YYYY)`);
    const zone = String(e.zone ?? "").trim().slice(0, 80);
    const key = `${e.period}|${zone}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (e.goal === null || e.goal === undefined || (e.goal as unknown) === "") {
      stmts.push(db.prepare("DELETE FROM baptism_goal WHERE period = ? AND zone = ?").bind(e.period, zone));
      removed++;
      continue;
    }
    if (!isGoalValue(e.goal)) throw new Error(`bad goal for ${e.period} ${zone || "mission"}: must be a whole number 0 to 9999`);
    stmts.push(
      db
        .prepare(
          `INSERT INTO baptism_goal (period, zone, goal, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (period, zone) DO UPDATE SET goal = excluded.goal, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
        )
        .bind(e.period, zone, e.goal, now, user),
    );
    written++;
  }
  for (let i = 0; i < stmts.length; i += 40) await db.batch(stmts.slice(i, i + 40));
  return { written, removed };
}

/** Progress for the month and year containing `asOf` (default today, mission time). */
export async function progressFor(db: D1Database, asOf: string = todayIso()): Promise<GoalProgress> {
  const [friends, rows] = await Promise.all([listFriends(db), listGoalRows(db)]);
  return baptismProgress(friends, rows, asOf);
}

/** Mission goal per month for the Trends chart. */
export async function goalsForMonths(db: D1Database, months: string[]): Promise<Record<string, number | null>> {
  return monthlyMissionGoals(await listGoalRows(db), months);
}

export interface GoalsView {
  year: string;
  /** "YYYY-01" … "YYYY-12" */
  months: string[];
  /** zones that have a goal or a baptism this year (the page merges in the current zone list) */
  zones: string[];
  rows: GoalRow[];
  /** confirmed named baptisms per period per zone ("" = mission), for the editing grid */
  actuals: Record<string, Record<string, number>>;
}

/** The editing grid for one year: every goal row and the actual counts beside them. */
export async function goalsView(db: D1Database, year: string): Promise<GoalsView> {
  const [rows, friends] = await Promise.all([listGoalRows(db, year), listFriends(db)]);
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  const done = countableBaptisms(friends).filter((f) => f.baptismDate!.startsWith(year));
  const actuals: Record<string, Record<string, number>> = {};
  const bump = (period: string, zone: string) => {
    const p = (actuals[period] ??= {});
    p[zone] = (p[zone] ?? 0) + 1;
  };
  for (const f of done) {
    const m = f.baptismDate!.slice(0, 7);
    bump(m, "");
    bump(year, "");
    if (f.zone) {
      bump(m, f.zone);
      bump(year, f.zone);
    }
  }
  const zones = [...new Set([...rows.map((r) => r.zone), ...done.map((f) => f.zone ?? "")])]
    .filter((z) => z !== "")
    .sort();
  return { year, months, zones, rows, actuals };
}
