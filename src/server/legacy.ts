/**
 * History from Tableau (docs/legacy-ki-export.md).
 *
 * Two one-off loads, both idempotent and both driven from Admin → Data:
 *   - indicator rows, one week at a time: stored as their own import run
 *     (raw_json marked source "tableau"), facts under the real IMOS area ids
 *     (Tableau exposes the same ids), an area_history row per area so the
 *     week never shows as "not reported". A week that already has an IMOS
 *     import is left alone: the paste is the record for those weeks.
 *   - baptized members by name and date: confirms the portal's legacy records
 *     where the name and date agree, and adds the rest as confirmed records
 *     keyed by their Tableau id so a second load changes nothing.
 */

import { nameKey } from "../pipeline/friends.js";
import { KI_IDS, type KiId } from "../shared/ki.js";
import { addDays, dayOfWeekMonday0, isIsoDate } from "../shared/dates.js";
import { bulkInsert, runBatch, sha256Hex } from "./db.js";
import { listFriends } from "./friends.js";

/** CSV column stems → IMOS indicator ids (src/shared/ki.ts). */
const STEM_TO_KI: Record<string, KiId> = { bc: 20, bd: 30, sa: 40, np: 100, lmp: 600, nms: 300 };

export interface LegacyAreaRow {
  area_id: number | string;
  zone: string;
  district?: string;
  area: string;
  [k: string]: unknown; // np_goal, np_actual, … as numbers, strings, or blank
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseInt(String(v).trim(), 10);
  return Number.isFinite(n) ? n : null;
}

export interface LegacyWeekResult {
  weekStart: string;
  weekEnd: string;
  areas: number;
  facts: number;
  /** the same rows were already stored */
  reused: boolean;
  /** "imos" when the week has an IMOS import and was left untouched */
  skipped?: "imos";
}

export async function storeLegacyWeek(
  db: D1Database,
  user: string,
  weekEnd: string,
  rows: LegacyAreaRow[],
): Promise<LegacyWeekResult> {
  if (!isIsoDate(weekEnd) || dayOfWeekMonday0(weekEnd) !== 6) throw new Error(`weekEnd must be a Sunday (YYYY-MM-DD), got ${weekEnd}`);
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 400) throw new Error("rows[] required (1–400 areas)");
  const weekStart = addDays(weekEnd, -6);

  const clean = rows.map((r) => {
    const areaId = num(r.area_id);
    const area = String(r.area ?? "").trim();
    if (areaId === null || areaId <= 0 || !area) throw new Error(`each row needs area_id and area (got ${JSON.stringify(r).slice(0, 80)})`);
    const kis: Record<string, { goal: number | null; actual: number }> = {};
    for (const stem of Object.keys(STEM_TO_KI)) {
      kis[stem] = { goal: num(r[`${stem}_goal`]), actual: num(r[`${stem}_actual`]) ?? 0 };
    }
    return { areaId, area, zone: String(r.zone ?? "").trim(), district: String(r.district ?? "").trim(), kis };
  });
  const seen = new Set<number>();
  for (const c of clean) {
    if (seen.has(c.areaId)) throw new Error(`area ${c.areaId} appears twice for ${weekEnd}`);
    seen.add(c.areaId);
  }

  const runs = await db
    .prepare("SELECT id, source_sha256 AS sha, substr(raw_json, 1, 20) AS head FROM import_run WHERE week_start = ?")
    .bind(weekStart)
    .all<{ id: number; sha: string; head: string }>();
  const existing = runs.results ?? [];
  if (existing.some((r) => !r.head.startsWith('{"source":"tableau"'))) {
    return { weekStart, weekEnd, areas: clean.length, facts: 0, reused: false, skipped: "imos" };
  }
  const rawJson = JSON.stringify({ source: "tableau", weekEnd, rows: clean });
  const sha = await sha256Hex(rawJson);
  const nFacts = clean.length * KI_IDS.length;
  const same = existing.find((r) => r.sha === sha);
  let runId: number;
  if (same) {
    const state = await db
      .prepare("SELECT COUNT(*) AS total, SUM(import_run_id = ?) AS mine FROM ki_fact WHERE week_start = ?")
      .bind(same.id, weekStart)
      .first<{ total: number; mine: number | null }>();
    if (state && state.total === nFacts && (state.mine ?? 0) === nFacts) {
      return { weekStart, weekEnd, areas: clean.length, facts: nFacts, reused: true };
    }
    runId = same.id;
  } else {
    const res = await db
      .prepare(
        `INSERT INTO import_run (week_start, week_end, imported_at, imported_by, source_sha256, raw_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(weekStart, weekEnd, new Date().toISOString().replace(/\.\d+Z$/, "Z"), user, sha, rawJson)
      .run();
    runId = Number(res.meta.last_row_id);
  }

  const factRows: unknown[][] = [];
  for (const c of clean) {
    for (const [stem, ki] of Object.entries(STEM_TO_KI)) {
      const cell = c.kis[stem]!;
      factRows.push([runId, weekStart, null, c.zone, null, c.district, c.areaId, c.area, ki, cell.goal, cell.actual, 0]);
    }
  }
  await runBatch(db, [
    ...bulkInsert(
      "ki_fact",
      ["import_run_id", "week_start", "imos_zone_id", "imos_zone_name", "imos_district_id", "imos_district_name",
        "imos_area_id", "imos_area_name", "ki_id", "goal", "actual", "is_mlc"],
      factRows,
      `ON CONFLICT (week_start, imos_area_id, ki_id) DO UPDATE SET
         import_run_id=excluded.import_run_id, imos_zone_name=excluded.imos_zone_name,
         imos_district_name=excluded.imos_district_name, imos_area_name=excluded.imos_area_name,
         goal=excluded.goal, actual=excluded.actual`,
    ),
    ...bulkInsert(
      "area_history",
      ["week_start", "imos_area_id", "imos_area_name", "modified_date", "updated_this_week"],
      clean.map((c) => [weekStart, c.areaId, c.area, weekEnd, 1]),
      `ON CONFLICT (week_start, imos_area_id) DO UPDATE SET
         imos_area_name=excluded.imos_area_name, modified_date=excluded.modified_date,
         updated_this_week=excluded.updated_this_week`,
    ),
    // rows from an earlier load of this week that the new rows no longer carry
    {
      sql: "DELETE FROM ki_fact WHERE week_start = ? AND import_run_id <> ?",
      params: [weekStart, runId],
    },
  ]);
  return { weekStart, weekEnd, areas: clean.length, facts: nFacts, reused: false };
}

export interface LegacyBaptismRow {
  external_id: string | number;
  name?: string;
  baptism_date?: string;
  zone?: string;
  district?: string;
  area?: string;
}

export interface LegacyBaptismResult {
  rows: number;
  /** already loaded under the same Tableau id */
  already: number;
  /** a sheet or portal record with the same name and date exists; nothing to add */
  matchedCurrent: number;
  /** a legacy backfill record was found and marked confirmed / given its zone */
  confirmedLegacy: number;
  inserted: number;
  /** no usable date */
  skipped: number;
}

const MATCH_WINDOW_DAYS = 45;
const dayNum = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;

export async function loadLegacyBaptisms(
  db: D1Database,
  user: string,
  rows: LegacyBaptismRow[],
): Promise<LegacyBaptismResult> {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 2000) throw new Error("rows[] required (1–2000)");
  const existing = await listFriends(db, { includeInactive: true });
  const byTableauId = new Set(existing.map((f) => f.syncKey).filter((k): k is string => !!k && k.startsWith("tableau:")));
  const baptizedByName = new Map<string, typeof existing>();
  for (const f of existing) {
    if (!f.baptizedConfirmed || !f.baptismDate) continue;
    const k = nameKey(f.name);
    const list = baptizedByName.get(k);
    if (list) list.push(f);
    else baptizedByName.set(k, [f]);
  }

  const out: LegacyBaptismResult = { rows: rows.length, already: 0, matchedCurrent: 0, confirmedLegacy: 0, inserted: 0, skipped: 0 };
  const stmts: D1PreparedStatement[] = [];
  const now = new Date().toISOString();
  for (const r of rows) {
    const id = String(r.external_id ?? "").trim();
    const date = String(r.baptism_date ?? "").trim();
    if (!id || !isIsoDate(date) || date < "2015-01-01") {
      out.skipped++;
      continue;
    }
    const key = `tableau:${id}`;
    if (byTableauId.has(key)) {
      out.already++;
      continue;
    }
    byTableauId.add(key);
    const name = String(r.name ?? "").trim();
    const zone = String(r.zone ?? "").trim() || null;
    const note = `Tableau: ${String(r.area ?? "").trim()}${r.district ? ` (${String(r.district).trim()})` : ""}`;

    const match = name
      ? (baptizedByName.get(nameKey(name)) ?? []).find(
          (f) => Math.abs(dayNum(f.baptismDate!) - dayNum(date)) <= MATCH_WINDOW_DAYS,
        )
      : undefined;
    if (match) {
      if (match.source === "sheet" || match.source === "portal") {
        // the live record is authoritative; never touch a sheet row's sync key
        out.matchedCurrent++;
        continue;
      }
      stmts.push(
        db
          .prepare(
            `UPDATE friend SET confidence = CASE WHEN confidence = 'unverified' THEN 'confirmed' ELSE confidence END,
               zone = COALESCE(zone, ?), sync_key = COALESCE(sync_key, ?),
               notes = CASE WHEN notes IS NULL OR notes = '' THEN ? ELSE notes || ' · ' || ? END,
               updated_at = ?, updated_by = ?
             WHERE id = ?`,
          )
          .bind(zone, key, note, note, now, user, match.id),
      );
      out.confirmedLegacy++;
      continue;
    }
    stmts.push(
      db
        .prepare(
          `INSERT INTO friend (id, name, zone, ward, stake, missionaries, baptism_date,
             baptism_time, baptism_address, attended_church_2x, on_baptism_calendar,
             baptized_confirmed, confirmed_at, confidence, notes, dropped, active, source,
             sync_key, created_at, created_by, updated_at, updated_by)
           VALUES (?, ?, ?, NULL, NULL, NULL, ?, NULL, NULL, 1, 1, 1, ?, 'confirmed', ?, 0, 1, 'tableau',
             ?, ?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), name || `Member (Tableau ${id})`, zone, date, now, note, key, now, user, now, user),
    );
    out.inserted++;
  }
  for (let i = 0; i < stmts.length; i += 20) await db.batch(stmts.slice(i, i + 20));
  return out;
}
