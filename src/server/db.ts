/**
 * D1 data layer. Ports ki-pipeline/pipeline/db.py + resolve.py's table reads to
 * Cloudflare D1, and adds area_history / friends / directory / config.
 *
 * Rows come back in the camelCase shapes the pipeline modules expect.
 */

import type {
  AreaCrosswalkRow,
  AreaWardRow,
  CanonicalAreaRow,
  SeedResult,
} from "../pipeline/crosswalkSeed.js";
import type {
  AreaHistoryRow,
  KiFact,
  MissionaryRow,
  NormalizeResult,
  WardFact,
} from "../pipeline/types.js";
import type { KiId } from "../shared/ki.js";

// --- bulk insert helper --------------------------------------------------
// D1 caps bound parameters at 100 per statement (well below SQLite's 999).
const MAX_PARAMS = 96;

interface Stmt {
  sql: string;
  params: unknown[];
}

function bulkInsert(
  table: string,
  columns: string[],
  rows: unknown[][],
  conflict: string,
): Stmt[] {
  if (rows.length === 0) return [];
  const perRow = columns.length;
  const rowsPerChunk = Math.max(1, Math.floor(MAX_PARAMS / perRow));
  const out: Stmt[] = [];
  for (let i = 0; i < rows.length; i += rowsPerChunk) {
    const chunk = rows.slice(i, i + rowsPerChunk);
    const placeholder = `(${columns.map(() => "?").join(",")})`;
    const sql =
      `INSERT INTO ${table} (${columns.join(",")}) VALUES ` +
      chunk.map(() => placeholder).join(",") +
      ` ${conflict}`;
    out.push({ sql, params: chunk.flat() });
  }
  return out;
}

async function runBatch(db: D1Database, stmts: Stmt[]): Promise<void> {
  if (stmts.length === 0) return;
  const prepared = stmts.map((s) => db.prepare(s.sql).bind(...s.params));
  // D1 batch is atomic; chunk defensively so a giant week never trips a limit.
  const CHUNK = 20;
  for (let i = 0; i < prepared.length; i += CHUNK) {
    await db.batch(prepared.slice(i, i + CHUNK));
  }
}

function sha256Hex(s: string): Promise<string> {
  const bytes = new TextEncoder().encode(s);
  return crypto.subtle.digest("SHA-256", bytes).then((buf) =>
    [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join(""),
  );
}

// --- import ------------------------------------------------------------
export interface ImportSummary {
  runId: number;
  weekStart: string;
  weekEnd: string;
  reused: boolean;
  nFacts: number;
  nWardFacts: number;
  nMissionaries: number;
  activeAreas: number;
  /** Rows from an earlier import of this week that the new payload no longer carries. */
  staleRemoved: number;
}

export async function storeImport(
  db: D1Database,
  norm: NormalizeResult,
  rawJson: string,
  importedBy: string,
): Promise<ImportSummary> {
  const sha = await sha256Hex(rawJson);
  const existing = await db
    .prepare("SELECT id FROM import_run WHERE week_start = ? AND source_sha256 = ?")
    .bind(norm.weekStart, sha)
    .first<{ id: number }>();

  let runId: number;
  let reused = false;
  if (existing) {
    runId = existing.id;
    // A true no-op only when every fact row stored for the week came from
    // this exact payload and all of them landed. A different pull imported
    // since would have re-stamped rows with its own run id (so re-importing
    // this one must put things back); a prior partial failure leaves fewer
    // rows than the payload carries.
    const state = await db
      .prepare(
        "SELECT COUNT(*) AS total, SUM(import_run_id = ?) AS mine FROM ki_fact WHERE week_start = ?",
      )
      .bind(runId, norm.weekStart)
      .first<{ total: number; mine: number | null }>();
    const complete =
      !!state && state.total === norm.facts.length && (state.mine ?? 0) === norm.facts.length;
    if (complete) {
      return {
        runId,
        weekStart: norm.weekStart,
        weekEnd: norm.weekEnd,
        reused: true,
        nFacts: norm.facts.length,
        nWardFacts: norm.wardFacts.length,
        nMissionaries: norm.missionaries.length,
        activeAreas: norm.activeAreaIds.size,
        staleRemoved: 0,
      };
    }
  } else {
    const res = await db
      .prepare(
        `INSERT INTO import_run (week_start, week_end, imported_at, imported_by, source_sha256, raw_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        norm.weekStart,
        norm.weekEnd,
        new Date().toISOString().replace(/\.\d+Z$/, "Z"),
        importedBy,
        sha,
        rawJson,
      )
      .run();
    runId = Number(res.meta.last_row_id);
  }

  // Upsert every row the new payload carries …
  await runBatch(db, [
    ...bulkInsert(
      "ki_fact",
      [
        "import_run_id",
        "week_start",
        "imos_zone_id",
        "imos_zone_name",
        "imos_district_id",
        "imos_district_name",
        "imos_area_id",
        "imos_area_name",
        "ki_id",
        "goal",
        "actual",
        "is_mlc",
      ],
      norm.facts.map((f) => [
        runId,
        f.weekStart,
        f.zoneId,
        f.zoneName,
        f.districtId,
        f.districtName,
        f.areaId,
        f.areaName,
        f.kiId,
        f.goal,
        f.actual,
        f.isMlc ? 1 : 0,
      ]),
      `ON CONFLICT (week_start, imos_area_id, ki_id) DO UPDATE SET
         import_run_id=excluded.import_run_id, imos_zone_id=excluded.imos_zone_id,
         imos_zone_name=excluded.imos_zone_name, imos_district_id=excluded.imos_district_id,
         imos_district_name=excluded.imos_district_name, imos_area_name=excluded.imos_area_name,
         goal=excluded.goal, actual=excluded.actual, is_mlc=excluded.is_mlc`,
    ),
    ...bulkInsert(
      "ward_fact",
      ["week_start", "imos_area_id", "org_id", "org_name", "ki_id", "actual"],
      norm.wardFacts.map((w) => [w.weekStart, w.imosAreaId, w.orgId, w.orgName, w.kiId, w.actual]),
      `ON CONFLICT (week_start, imos_area_id, org_id, ki_id) DO UPDATE SET
         org_name=excluded.org_name, actual=excluded.actual`,
    ),
    ...bulkInsert(
      "missionary_snapshot",
      ["week_start", "missionary_id", "first_name", "last_name", "imos_area_id", "position"],
      norm.missionaries.map((m) => [
        m.weekStart,
        m.missionaryId,
        m.firstName,
        m.lastName,
        m.imosAreaId,
        m.position,
      ]),
      `ON CONFLICT (week_start, missionary_id) DO UPDATE SET
         first_name=excluded.first_name, last_name=excluded.last_name,
         imos_area_id=excluded.imos_area_id, position=excluded.position`,
    ),
    ...bulkInsert(
      "area_history",
      ["week_start", "imos_area_id", "imos_area_name", "modified_date", "updated_this_week"],
      norm.areaHistory.map((h) => [
        h.weekStart,
        h.imosAreaId,
        h.imosAreaName,
        h.modifiedDate,
        h.updatedThisWeek ? 1 : 0,
      ]),
      `ON CONFLICT (week_start, imos_area_id) DO UPDATE SET
         imos_area_name=excluded.imos_area_name, modified_date=excluded.modified_date,
         updated_this_week=excluded.updated_this_week`,
    ),
  ]);

  // … then drop anything left over from an earlier import of the same week.
  // A week re-pulled after corrections can lose an area (closed, deactivated)
  // or an org; without this the stale rows would keep being counted. Keyed
  // deletes via json_each keep each statement at two parameters regardless of
  // how many areas the mission has. Runs last so a failure mid-import leaves
  // extra rows (caught on the next run), never missing ones.
  const areaIds = JSON.stringify([...norm.activeAreaIds]);
  const orgKeys = JSON.stringify(
    [...new Set(norm.wardFacts.map((w) => `${w.imosAreaId}:${w.orgId}`))],
  );
  const missionaryIds = JSON.stringify([...new Set(norm.missionaries.map((m) => m.missionaryId))]);
  const pruned = await db.batch([
    db
      .prepare("DELETE FROM ki_fact WHERE week_start = ? AND import_run_id <> ?")
      .bind(norm.weekStart, runId),
    db
      .prepare(
        `DELETE FROM ward_fact WHERE week_start = ?
           AND (imos_area_id || ':' || org_id) NOT IN (SELECT value FROM json_each(?))`,
      )
      .bind(norm.weekStart, orgKeys),
    db
      .prepare(
        `DELETE FROM missionary_snapshot WHERE week_start = ?
           AND missionary_id NOT IN (SELECT value FROM json_each(?))`,
      )
      .bind(norm.weekStart, missionaryIds),
    db
      .prepare(
        `DELETE FROM area_history WHERE week_start = ?
           AND imos_area_id NOT IN (SELECT value FROM json_each(?))`,
      )
      .bind(norm.weekStart, areaIds),
  ]);
  const staleRemoved = pruned.reduce((n, r) => n + (r.meta?.changes ?? 0), 0);

  return {
    runId,
    weekStart: norm.weekStart,
    weekEnd: norm.weekEnd,
    reused,
    nFacts: norm.facts.length,
    nWardFacts: norm.wardFacts.length,
    nMissionaries: norm.missionaries.length,
    activeAreas: norm.activeAreaIds.size,
    staleRemoved,
  };
}

// --- fact reads -------------------------------------------------------
export async function loadFacts(db: D1Database, weekStart: string): Promise<KiFact[]> {
  const { results } = await db
    .prepare(
      `SELECT week_start, imos_zone_id, imos_zone_name, imos_district_id, imos_district_name,
              imos_area_id, imos_area_name, ki_id, goal, actual, is_mlc
       FROM ki_fact WHERE week_start = ?
       ORDER BY imos_zone_name, imos_area_name, ki_id`,
    )
    .bind(weekStart)
    .all<Record<string, number | string | null>>();
  return (results ?? []).map((r) => ({
    weekStart: r.week_start as string,
    zoneId: (r.imos_zone_id as number) ?? 0,
    zoneName: (r.imos_zone_name as string) ?? "",
    districtId: (r.imos_district_id as number) ?? 0,
    districtName: (r.imos_district_name as string) ?? "",
    areaId: r.imos_area_id as number,
    areaName: r.imos_area_name as string,
    kiId: r.ki_id as KiId,
    goal: (r.goal as number | null) ?? null,
    actual: (r.actual as number) ?? 0,
    isMlc: Boolean(r.is_mlc),
  }));
}

export async function loadWardFacts(db: D1Database, weekStart: string): Promise<WardFact[]> {
  const { results } = await db
    .prepare(
      `SELECT week_start, imos_area_id, org_id, org_name, ki_id, actual
       FROM ward_fact WHERE week_start = ? ORDER BY org_name, ki_id`,
    )
    .bind(weekStart)
    .all<Record<string, number | string>>();
  return (results ?? []).map((r) => ({
    weekStart: r.week_start as string,
    imosAreaId: r.imos_area_id as number,
    orgId: r.org_id as number,
    orgName: r.org_name as string,
    kiId: r.ki_id as KiId,
    actual: (r.actual as number) ?? 0,
  }));
}

export async function weeksAvailable(db: D1Database): Promise<string[]> {
  // import_run is one row per import; the EXISTS seeks ix_ki_fact_week once
  // per week. The old DISTINCT over ki_fact scanned every fact row on every
  // call, and this runs several times per uncached request — over years that
  // is the difference between hundreds and hundreds of thousands of row reads.
  const { results } = await db
    .prepare(
      `SELECT DISTINCT ir.week_start FROM import_run ir
       WHERE EXISTS (SELECT 1 FROM ki_fact k WHERE k.week_start = ir.week_start)
       ORDER BY ir.week_start`,
    )
    .all<{ week_start: string }>();
  return (results ?? []).map((r) => r.week_start);
}

export async function loadAreaHistory(
  db: D1Database,
  weekStart: string,
): Promise<AreaHistoryRow[]> {
  const { results } = await db
    .prepare(
      `SELECT week_start, imos_area_id, imos_area_name, modified_date, updated_this_week
       FROM area_history WHERE week_start = ?`,
    )
    .bind(weekStart)
    .all<Record<string, string | number | null>>();
  return (results ?? []).map((r) => ({
    weekStart: r.week_start as string,
    imosAreaId: r.imos_area_id as number,
    imosAreaName: r.imos_area_name as string,
    modifiedDate: (r.modified_date as string | null) ?? null,
    updatedThisWeek: Boolean(r.updated_this_week),
  }));
}

// --- weekly console check-offs -----------------------------------
export async function getConsoleChecks(db: D1Database, weekStart: string): Promise<Set<string>> {
  const { results } = await db
    .prepare("SELECT step_id FROM console_check WHERE week_start = ?")
    .bind(weekStart)
    .all<{ step_id: string }>();
  return new Set((results ?? []).map((r) => r.step_id));
}

export async function setConsoleCheck(
  db: D1Database,
  weekStart: string,
  stepId: string,
  checked: boolean,
  actor: string,
): Promise<void> {
  if (checked) {
    await db
      .prepare(
        `INSERT INTO console_check (week_start, step_id, checked_at, checked_by)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (week_start, step_id) DO UPDATE SET checked_at = excluded.checked_at, checked_by = excluded.checked_by`,
      )
      .bind(weekStart, stepId, new Date().toISOString(), actor)
      .run();
  } else {
    await db
      .prepare("DELETE FROM console_check WHERE week_start = ? AND step_id = ?")
      .bind(weekStart, stepId)
      .run();
  }
}

// --- "not reported" acknowledgements ------------------------------
export interface NotReportedAck {
  imosAreaId: number;
  reason: string | null;
  ackedAt: string;
  ackedBy: string | null;
}

export async function getNotReportedAcks(
  db: D1Database,
  weekStart: string,
): Promise<NotReportedAck[]> {
  const { results } = await db
    .prepare(
      "SELECT imos_area_id, reason, acked_at, acked_by FROM not_reported_ack WHERE week_start = ?",
    )
    .bind(weekStart)
    .all<Record<string, string | number | null>>();
  return (results ?? []).map((r) => ({
    imosAreaId: r.imos_area_id as number,
    reason: (r.reason as string | null) ?? null,
    ackedAt: r.acked_at as string,
    ackedBy: (r.acked_by as string | null) ?? null,
  }));
}

export async function setNotReportedAck(
  db: D1Database,
  weekStart: string,
  imosAreaId: number,
  reason: string | null,
  actor: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO not_reported_ack (week_start, imos_area_id, reason, acked_at, acked_by)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (week_start, imos_area_id) DO UPDATE SET
         reason = excluded.reason, acked_at = excluded.acked_at, acked_by = excluded.acked_by`,
    )
    .bind(weekStart, imosAreaId, reason, new Date().toISOString(), actor)
    .run();
}

export async function clearNotReportedAck(
  db: D1Database,
  weekStart: string,
  imosAreaId: number,
): Promise<void> {
  await db
    .prepare("DELETE FROM not_reported_ack WHERE week_start = ? AND imos_area_id = ?")
    .bind(weekStart, imosAreaId)
    .run();
}

// --- crosswalk reads ------------------------------------------------
export async function getCrosswalkRows(db: D1Database): Promise<AreaCrosswalkRow[]> {
  const { results } = await db
    .prepare("SELECT imos_area_id, canonical_area_key, valid_from, valid_to, note FROM area_crosswalk")
    .all<Record<string, string | number | null>>();
  return (results ?? []).map((r) => ({
    imosAreaId: r.imos_area_id as number,
    canonicalAreaKey: r.canonical_area_key as string,
    validFrom: r.valid_from as string,
    validTo: (r.valid_to as string | null) ?? null,
    note: (r.note as string | null) ?? null,
  }));
}

export async function getAreaWardRows(db: D1Database): Promise<AreaWardRow[]> {
  const { results } = await db
    .prepare(
      "SELECT canonical_area_key, ward_unit_id, ward_name, stake, valid_from, valid_to FROM area_ward",
    )
    .all<Record<string, string | number | null>>();
  return (results ?? []).map((r) => ({
    canonicalAreaKey: r.canonical_area_key as string,
    wardUnitId: r.ward_unit_id as number,
    wardName: r.ward_name as string,
    stake: r.stake as string,
    validFrom: r.valid_from as string,
    validTo: (r.valid_to as string | null) ?? null,
  }));
}

export async function getCanonicalRows(db: D1Database): Promise<CanonicalAreaRow[]> {
  const { results } = await db
    .prepare("SELECT canonical_area_key, display_name, created_at FROM canonical_area")
    .all<Record<string, string>>();
  return (results ?? []).map((r) => ({
    canonicalAreaKey: r.canonical_area_key as string,
    displayName: r.display_name as string,
    createdAt: r.created_at as string,
  }));
}

// --- crosswalk writes ----------------------------------------------
export async function seedCrosswalk(db: D1Database, s: SeedResult): Promise<void> {
  await runBatch(db, [
    ...bulkInsert(
      "canonical_area",
      ["canonical_area_key", "display_name", "created_at"],
      s.canonicalAreas.map((c) => [c.canonicalAreaKey, c.displayName, c.createdAt]),
      "ON CONFLICT (canonical_area_key) DO UPDATE SET display_name=excluded.display_name",
    ),
    ...bulkInsert(
      "area_crosswalk",
      ["imos_area_id", "canonical_area_key", "valid_from", "valid_to", "note"],
      s.areaCrosswalk.map((r) => [r.imosAreaId, r.canonicalAreaKey, r.validFrom, r.validTo, r.note]),
      "ON CONFLICT (imos_area_id, valid_from) DO UPDATE SET canonical_area_key=excluded.canonical_area_key, note=excluded.note",
    ),
    ...bulkInsert(
      "area_ward",
      ["canonical_area_key", "ward_unit_id", "ward_name", "stake", "valid_from", "valid_to"],
      s.areaWard.map((r) => [
        r.canonicalAreaKey,
        r.wardUnitId,
        r.wardName,
        r.stake,
        r.validFrom,
        r.validTo,
      ]),
      "ON CONFLICT (canonical_area_key, ward_unit_id, valid_from) DO UPDATE SET ward_name=excluded.ward_name, stake=excluded.stake",
    ),
  ]);
}

export async function attachArea(
  db: D1Database,
  imosAreaId: number,
  canonicalAreaKey: string,
  validFrom: string,
  note: string | null,
): Promise<void> {
  const exists = await db
    .prepare("SELECT 1 FROM canonical_area WHERE canonical_area_key = ?")
    .bind(canonicalAreaKey)
    .first();
  if (!exists) {
    throw new Error(
      `canonical area "${canonicalAreaKey}" does not exist — create it first (or tick "New?" in Rollover)`,
    );
  }
  await db.batch([
    // close whatever was open before this date
    db
      .prepare(
        `UPDATE area_crosswalk SET valid_to = ?
         WHERE imos_area_id = ? AND valid_to IS NULL AND valid_from < ?`,
      )
      .bind(validFrom, imosAreaId, validFrom),
    db
      .prepare(
        `INSERT INTO area_crosswalk (imos_area_id, canonical_area_key, valid_from, valid_to, note)
         VALUES (?, ?, ?, NULL, ?)
         ON CONFLICT (imos_area_id, valid_from) DO UPDATE SET
           canonical_area_key = excluded.canonical_area_key, note = excluded.note`,
      )
      .bind(imosAreaId, canonicalAreaKey, validFrom, note),
    // back-dating under a mapping that starts later: end the new row where
    // that later one begins, so no two rows are ever effective on one week
    db
      .prepare(
        `UPDATE area_crosswalk SET valid_to = (
           SELECT MIN(valid_from) FROM area_crosswalk x
           WHERE x.imos_area_id = ? AND x.valid_from > ?)
         WHERE imos_area_id = ? AND valid_from = ? AND valid_to IS NULL
           AND EXISTS (SELECT 1 FROM area_crosswalk y WHERE y.imos_area_id = ? AND y.valid_from > ?)`,
      )
      .bind(imosAreaId, validFrom, imosAreaId, validFrom, imosAreaId, validFrom),
  ]);
}

export async function createCanonicalArea(
  db: D1Database,
  key: string,
  displayName: string,
  createdAt: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO canonical_area (canonical_area_key, display_name, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT (canonical_area_key) DO UPDATE SET display_name = excluded.display_name`,
    )
    .bind(key, displayName, createdAt)
    .run();
}

export async function addWard(
  db: D1Database,
  canonicalAreaKey: string,
  wardUnitId: number,
  wardName: string,
  stake: string,
  validFrom: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO area_ward (canonical_area_key, ward_unit_id, ward_name, stake, valid_from, valid_to)
       VALUES (?, ?, ?, ?, ?, NULL)
       ON CONFLICT (canonical_area_key, ward_unit_id, valid_from) DO UPDATE SET
         ward_name = excluded.ward_name, stake = excluded.stake`,
    )
    .bind(canonicalAreaKey, wardUnitId, wardName, stake, validFrom)
    .run();
}

// --- config + audit --------------------------------------------------
export async function getConfig<T>(db: D1Database, key: string, fallback: T): Promise<T> {
  const row = await db
    .prepare("SELECT value_json FROM config WHERE key = ?")
    .bind(key)
    .first<{ value_json: string }>();
  if (!row) return fallback;
  try {
    return JSON.parse(row.value_json) as T;
  } catch {
    return fallback;
  }
}

export async function setConfig(db: D1Database, key: string, value: unknown): Promise<void> {
  await db
    .prepare(
      `INSERT INTO config (key, value_json) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`,
    )
    .bind(key, JSON.stringify(value))
    .run();
}

export async function audit(
  db: D1Database,
  actor: string,
  action: string,
  detail: unknown,
): Promise<void> {
  await db
    .prepare("INSERT INTO audit_log (at, actor, action, detail_json) VALUES (?, ?, ?, ?)")
    .bind(new Date().toISOString(), actor, action, JSON.stringify(detail ?? null))
    .run();
}

// --- data page (read-only browse) ----------------------------------
export async function getImportLog(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT ir.week_start, ir.week_end, ir.imported_at, ir.imported_by, ir.source_sha256,
              (SELECT COUNT(*) FROM ki_fact k WHERE k.week_start = ir.week_start) AS n_facts
       FROM import_run ir ORDER BY ir.week_start DESC`,
    )
    .all<Record<string, string | number | null>>();
  return (results ?? []).map((r) => ({
    weekStart: r.week_start as string,
    weekEnd: r.week_end as string,
    importedAt: r.imported_at as string,
    importedBy: (r.imported_by as string | null) ?? null,
    sha: (r.source_sha256 as string).slice(0, 12),
    nFacts: (r.n_facts as number) ?? 0,
  }));
}

export async function getAuditLog(db: D1Database, limit = 100) {
  const { results } = await db
    .prepare("SELECT at, actor, action, detail_json FROM audit_log ORDER BY id DESC LIMIT ?")
    .bind(limit)
    .all<Record<string, string | null>>();
  return (results ?? []).map((r) => ({
    at: r.at as string,
    actor: (r.actor as string | null) ?? "",
    action: r.action as string,
    detail: r.detail_json ?? null,
  }));
}

export async function getFriendSyncLog(db: D1Database, limit = 30) {
  const { results } = await db
    .prepare(
      "SELECT at, rows_in, upserted, deactivated, warnings FROM friend_sync ORDER BY id DESC LIMIT ?",
    )
    .bind(limit)
    .all<Record<string, string | number | null>>();
  return (results ?? []).map((r) => ({
    at: r.at as string,
    rowsIn: (r.rows_in as number) ?? 0,
    upserted: (r.upserted as number) ?? 0,
    deactivated: (r.deactivated as number) ?? 0,
    warnings: (r.warnings as string | null) ?? null,
  }));
}

export async function getRawPayload(db: D1Database, weekStart: string): Promise<string | null> {
  const r = await db
    .prepare("SELECT raw_json FROM import_run WHERE week_start = ? ORDER BY id DESC LIMIT 1")
    .bind(weekStart)
    .first<{ raw_json: string }>();
  return r?.raw_json ?? null;
}

// --- stake report recipients ---------------------------------------
export interface StakeRecipient {
  stake: string;
  presidentName: string | null;
  toEmails: string | null;
  ccEmails: string | null;
}

export async function getStakeRecipients(db: D1Database): Promise<StakeRecipient[]> {
  const { results } = await db
    .prepare(
      "SELECT stake, president_name, to_emails, cc_emails FROM stake_recipients ORDER BY stake",
    )
    .all<Record<string, string | null>>();
  return (results ?? []).map((r) => ({
    stake: r.stake as string,
    presidentName: r.president_name ?? null,
    toEmails: r.to_emails ?? null,
    ccEmails: r.cc_emails ?? null,
  }));
}

export async function upsertStakeRecipient(
  db: D1Database,
  r: StakeRecipient,
  actor: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO stake_recipients (stake, president_name, to_emails, cc_emails, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (stake) DO UPDATE SET
         president_name = excluded.president_name, to_emails = excluded.to_emails,
         cc_emails = excluded.cc_emails, updated_at = excluded.updated_at,
         updated_by = excluded.updated_by`,
    )
    .bind(
      r.stake,
      r.presidentName,
      r.toEmails,
      r.ccEmails,
      new Date().toISOString(),
      actor,
    )
    .run();
}

// --- MLC recompute (config-driven, at read time) -----------------------
/** Area ids that hold one of `positions` in the week's missionary snapshot. */
export async function mlcAreaIdsForWeek(
  db: D1Database,
  weekStart: string,
  positions: string[],
): Promise<Set<number>> {
  if (positions.length === 0) return new Set();
  const ph = positions.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT DISTINCT imos_area_id FROM missionary_snapshot
       WHERE week_start = ? AND position IN (${ph})`,
    )
    .bind(weekStart, ...positions)
    .all<{ imos_area_id: number }>();
  return new Set((results ?? []).map((r) => r.imos_area_id));
}

export async function distinctPositions(db: D1Database): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT DISTINCT position FROM missionary_snapshot WHERE position <> '' ORDER BY position")
    .all<{ position: string }>();
  return (results ?? []).map((r) => r.position);
}

// --- structure (Admin → Areas) ---------------------------------------
export interface StructureArea {
  key: string;
  displayName: string;
  createdAt: string;
  retiredAt: string | null;
  mappings: {
    imosAreaId: number;
    imosAreaName: string;
    validFrom: string;
    validTo: string | null;
    note: string | null;
    open: boolean;
  }[];
  wards: {
    wardUnitId: number;
    wardName: string;
    stake: string;
    validFrom: string;
    validTo: string | null;
    open: boolean;
  }[];
}
export interface Structure {
  areas: StructureArea[];
  stakes: string[];
  zones: string[];
  positionsSeen: string[];
}

export async function getStructure(db: D1Database): Promise<Structure> {
  const [canonical, crosswalk, areaWard, names, zones, positionsSeen] = await Promise.all([
    getCanonicalRowsFull(db),
    getCrosswalkRows(db),
    getAreaWardRows(db),
    latestAreaNames(db),
    distinctZones(db),
    distinctPositions(db),
  ]);

  const byKey = new Map<string, StructureArea>();
  for (const c of canonical) {
    byKey.set(c.canonicalAreaKey, {
      key: c.canonicalAreaKey,
      displayName: c.displayName,
      createdAt: c.createdAt,
      retiredAt: c.retiredAt,
      mappings: [],
      wards: [],
    });
  }
  for (const m of crosswalk) {
    const a = byKey.get(m.canonicalAreaKey);
    if (!a) continue;
    a.mappings.push({
      imosAreaId: m.imosAreaId,
      imosAreaName: names.get(m.imosAreaId) ?? `#${m.imosAreaId}`,
      validFrom: m.validFrom,
      validTo: m.validTo,
      note: m.note,
      open: m.validTo === null,
    });
  }
  for (const w of areaWard) {
    const a = byKey.get(w.canonicalAreaKey);
    if (!a) continue;
    a.wards.push({
      wardUnitId: w.wardUnitId,
      wardName: w.wardName,
      stake: w.stake,
      validFrom: w.validFrom,
      validTo: w.validTo,
      open: w.validTo === null,
    });
  }
  const areas = [...byKey.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  for (const a of areas) {
    a.mappings.sort((x, y) => y.validFrom.localeCompare(x.validFrom));
    a.wards.sort((x, y) => x.wardName.localeCompare(y.wardName));
  }
  const stakes = [...new Set(areaWard.map((w) => w.stake))].sort();
  return { areas, stakes, zones, positionsSeen };
}

interface CanonicalFull {
  canonicalAreaKey: string;
  displayName: string;
  createdAt: string;
  retiredAt: string | null;
}
async function getCanonicalRowsFull(db: D1Database): Promise<CanonicalFull[]> {
  const { results } = await db
    .prepare("SELECT canonical_area_key, display_name, created_at, retired_at FROM canonical_area")
    .all<Record<string, string | null>>();
  return (results ?? []).map((r) => ({
    canonicalAreaKey: r.canonical_area_key as string,
    displayName: r.display_name as string,
    createdAt: r.created_at as string,
    retiredAt: (r.retired_at as string | null) ?? null,
  }));
}

async function latestAreaNames(db: D1Database): Promise<Map<number, string>> {
  // SQLite bare-column rule: with a single MAX() aggregate, the other selected
  // columns come from the row holding that max. One scan, no correlated subquery.
  const { results } = await db
    .prepare(
      `SELECT imos_area_id, imos_area_name, MAX(week_start) AS w
       FROM ki_fact GROUP BY imos_area_id`,
    )
    .all<{ imos_area_id: number; imos_area_name: string }>();
  return new Map((results ?? []).map((r) => [r.imos_area_id, r.imos_area_name]));
}

async function distinctZones(db: D1Database): Promise<string[]> {
  const { results } = await db
    .prepare(
      "SELECT DISTINCT imos_zone_name FROM ki_fact WHERE imos_zone_name <> '' ORDER BY imos_zone_name",
    )
    .all<{ imos_zone_name: string }>();
  return (results ?? []).map((r) => r.imos_zone_name);
}

export async function distinctZonesForWeek(db: D1Database, weekStart: string): Promise<string[]> {
  const { results } = await db
    .prepare(
      "SELECT DISTINCT imos_zone_name FROM ki_fact WHERE week_start = ? AND imos_zone_name <> ''",
    )
    .bind(weekStart)
    .all<{ imos_zone_name: string }>();
  return (results ?? []).map((r) => r.imos_zone_name);
}

export async function distinctAreaIdsForWeek(db: D1Database, weekStart: string): Promise<number[]> {
  const { results } = await db
    .prepare("SELECT DISTINCT imos_area_id FROM ki_fact WHERE week_start = ?")
    .bind(weekStart)
    .all<{ imos_area_id: number }>();
  return (results ?? []).map((r) => r.imos_area_id);
}

// --- crosswalk edits (Admin) -----------------------------------------
export async function renameCanonical(db: D1Database, key: string, displayName: string) {
  await db
    .prepare("UPDATE canonical_area SET display_name = ? WHERE canonical_area_key = ?")
    .bind(displayName, key)
    .run();
}

export async function setCanonicalRetired(db: D1Database, key: string, retiredAt: string | null) {
  await db
    .prepare("UPDATE canonical_area SET retired_at = ? WHERE canonical_area_key = ?")
    .bind(retiredAt, key)
    .run();
}

export async function closeMapping(
  db: D1Database,
  imosAreaId: number,
  validFrom: string,
  validTo: string,
) {
  await db
    .prepare(
      "UPDATE area_crosswalk SET valid_to = ? WHERE imos_area_id = ? AND valid_from = ?",
    )
    .bind(validTo, imosAreaId, validFrom)
    .run();
}

export async function closeWard(
  db: D1Database,
  canonicalAreaKey: string,
  wardUnitId: number,
  validFrom: string,
  validTo: string,
) {
  await db
    .prepare(
      "UPDATE area_ward SET valid_to = ? WHERE canonical_area_key = ? AND ward_unit_id = ? AND valid_from = ?",
    )
    .bind(validTo, canonicalAreaKey, wardUnitId, validFrom)
    .run();
}

/**
 * Rename a stake everywhere it is stored by name: the ward→stake rows, the
 * report recipients row (merged into an existing row for the new name if one
 * exists), and the friend records that carry the old name. Returns the number
 * of ward rows changed.
 */
export async function renameStake(db: D1Database, from: string, to: string): Promise<number> {
  const [wards] = await db.batch([
    db.prepare("UPDATE area_ward SET stake = ? WHERE stake = ?").bind(to, from),
    // recipients: keep the target row if it already exists, else rename
    db
      .prepare(
        `UPDATE stake_recipients SET stake = ? WHERE stake = ?
           AND NOT EXISTS (SELECT 1 FROM stake_recipients r WHERE r.stake = ?)`,
      )
      .bind(to, from, to),
    db
      .prepare("DELETE FROM stake_recipients WHERE stake = ? AND EXISTS (SELECT 1 FROM stake_recipients r WHERE r.stake = ?)")
      .bind(from, to),
    db.prepare("UPDATE friend SET stake = ? WHERE stake = ?").bind(to, from),
  ]);
  return wards?.meta.changes ?? 0;
}

/** Remove a portal-recorded baptism, including its weekly snapshot rows (FK). */
export async function deletePortalFriend(db: D1Database, id: string): Promise<boolean> {
  const [, del] = await db.batch([
    db.prepare("DELETE FROM friend_week WHERE friend_id = ? AND EXISTS (SELECT 1 FROM friend f WHERE f.id = ? AND f.source = 'portal')").bind(id, id),
    db.prepare("DELETE FROM friend WHERE id = ? AND source = 'portal'").bind(id),
  ]);
  return (del?.meta.changes ?? 0) > 0;
}
