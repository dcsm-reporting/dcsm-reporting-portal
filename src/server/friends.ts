/**
 * Friends / on-date data layer + sheet sync. D1-backed, read-only in the portal.
 *
 * The "Baptisms (MLC)" Google Sheet stays the STL working surface. An Apps
 * Script bound to it POSTs a full snapshot to /api/friends/sync; syncFriends()
 * upserts by a natural key, deactivates anyone who left the sheet, and takes a
 * weekly snapshot for the stake-report trends.
 */

import {
  cleanTime,
  isOnDate,
  summarise,
  toIsoDate,
  yn,
  type Friend,
  type FriendsSummary,
} from "../pipeline/friends.js";
import { getAreaWardRows } from "./db.js";
import { wardMapForWeek } from "../pipeline/resolve.js";

type Row = Record<string, string | number | null>;
export type StoredFriend = Friend & {
  active: boolean;
  syncKey: string | null;
  leftSheetAt: string | null;
};

const COLS =
  "id, name, zone, canonical_area_key, ward, stake, missionaries, baptism_date, baptism_time, " +
  "baptism_address, attended_church_2x, on_baptism_calendar, baptized_confirmed, dropped, active, " +
  "left_sheet_at, confirmed_at, confidence, notes, source, sync_key, created_at, created_by, " +
  "updated_at, updated_by";

function toFriend(r: Row): StoredFriend {
  return {
    id: r.id as string,
    name: r.name as string,
    zone: (r.zone as string | null) ?? null,
    canonicalAreaKey: (r.canonical_area_key as string | null) ?? null,
    ward: (r.ward as string | null) ?? null,
    stake: (r.stake as string | null) ?? null,
    missionaries: (r.missionaries as string | null) ?? null,
    baptismDate: (r.baptism_date as string | null) ?? null,
    baptismTime: (r.baptism_time as string | null) ?? null,
    baptismAddress: (r.baptism_address as string | null) ?? null,
    attendedChurch2x: Boolean(r.attended_church_2x),
    onBaptismCalendar: Boolean(r.on_baptism_calendar),
    baptizedConfirmed: Boolean(r.baptized_confirmed),
    confidence: (r.confidence as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    dropped: Boolean(r.dropped),
    source: (r.source as string) ?? "portal",
    createdAt: r.created_at as string,
    createdBy: (r.created_by as string | null) ?? null,
    updatedAt: r.updated_at as string,
    updatedBy: (r.updated_by as string | null) ?? null,
    active: Boolean(r.active),
    syncKey: (r.sync_key as string | null) ?? null,
    leftSheetAt: (r.left_sheet_at as string | null) ?? null,
    confirmedAt: (r.confirmed_at as string | null) ?? null,
  };
}

export async function listFriends(
  db: D1Database,
  opts: {
    zone?: string;
    stake?: string;
    status?: "on-date" | "baptized" | "all";
    includeInactive?: boolean;
  } = {},
): Promise<StoredFriend[]> {
  const where: string[] = [];
  const bind: unknown[] = [];
  if (!opts.includeInactive) where.push("active = 1");
  if (opts.zone) (where.push("zone = ?"), bind.push(opts.zone));
  if (opts.stake) (where.push("stake = ?"), bind.push(opts.stake));
  if (opts.status === "on-date")
    where.push("baptized_confirmed = 0 AND dropped = 0 AND baptism_date IS NOT NULL");
  else if (opts.status === "baptized") where.push("baptized_confirmed = 1");
  const sql =
    `SELECT ${COLS} FROM friend` +
    (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
    " ORDER BY baptized_confirmed, baptism_date IS NULL, baptism_date, name";
  const { results } = await db.prepare(sql).bind(...bind).all<Row>();
  return (results ?? []).map(toFriend);
}

export async function getFriend(db: D1Database, id: string): Promise<StoredFriend | null> {
  const r = await db.prepare(`SELECT ${COLS} FROM friend WHERE id = ?`).bind(id).first<Row>();
  return r ? toFriend(r) : null;
}

export async function friendsSummary(
  db: D1Database,
  weekStart: string | null,
): Promise<FriendsSummary & { lastSyncedAt: string | null }> {
  const [friends, lastSync] = await Promise.all([
    listFriends(db),
    db.prepare("SELECT at FROM friend_sync ORDER BY id DESC LIMIT 1").first<{ at: string }>(),
  ]);
  return { ...summarise(friends, weekStart), lastSyncedAt: lastSync?.at ?? null };
}

/**
 * Per-stake lists for the Stakes page / stake-president report:
 *   onDate    — everyone currently on a baptismal date
 *   baptized  — baptized in the last 6 months (matches the old report's page 2)
 */
export async function friendsByStake(db: D1Database, weekStart: string) {
  const friends = await listFriends(db);
  const wardMap = wardMapForWeek(await getAreaWardRows(db), weekStart);
  const stakeOfWard = new Map<string, string>();
  for (const [, [wardName, stake]] of wardMap) stakeOfWard.set(wardName.toLowerCase(), stake);

  const cutoff = new Date(Date.parse(`${weekStart}T00:00:00Z`));
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 6);
  const sixMonthsAgo = cutoff.toISOString().slice(0, 10);

  const byStake: Record<string, { onDate: Friend[]; baptized: Friend[] }> = {};
  const bucket = (s: string) => (byStake[s] ??= { onDate: [], baptized: [] });

  for (const f of friends) {
    const stake = f.stake || stakeOfWard.get((f.ward ?? "").toLowerCase()) || "(unassigned)";
    if (isOnDate(f)) bucket(stake).onDate.push(f);
    if (f.baptizedConfirmed && (f.baptismDate ?? "") >= sixMonthsAgo) {
      bucket(stake).baptized.push(f);
    }
  }
  for (const g of Object.values(byStake)) {
    g.onDate.sort((a, b) => (a.baptismDate ?? "").localeCompare(b.baptismDate ?? ""));
    g.baptized.sort((a, b) => (b.baptismDate ?? "").localeCompare(a.baptismDate ?? ""));
  }
  return byStake;
}

/**
 * Completed-baptism counts for the last `months` calendar months (oldest first),
 * split confirmed vs unverified-legacy. Feeds the Trends baptism bar chart.
 */
export async function monthlyBaptisms(
  db: D1Database,
  months = 6,
): Promise<{ month: string; confirmed: number; unverified: number }[]> {
  const now = new Date();
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    keys.push(d.toISOString().slice(0, 7));
  }
  const earliest = keys[0]!;
  const { results } = await db
    .prepare(
      `SELECT substr(baptism_date,1,7) AS m,
              sum(CASE WHEN confidence IS NULL OR confidence='confirmed' THEN 1 ELSE 0 END) AS c,
              sum(CASE WHEN confidence='unverified' THEN 1 ELSE 0 END) AS u
       FROM friend
       WHERE baptized_confirmed = 1 AND baptism_date >= ?
       GROUP BY m`,
    )
    .bind(`${earliest}-01`)
    .all<{ m: string; c: number; u: number }>();
  const byMonth = new Map((results ?? []).map((r) => [r.m, r]));
  return keys.map((month) => ({
    month,
    confirmed: byMonth.get(month)?.c ?? 0,
    unverified: byMonth.get(month)?.u ?? 0,
  }));
}

// --- portal-native record (close-the-gap on reconciliation) --------------
export interface RecordInput {
  name: string;
  baptismDate: string; // YYYY-MM-DD
  ward?: string | null;
  stake?: string | null;
  zone?: string | null;
  missionaries?: string | null;
  notes?: string | null;
}

/**
 * Add a completed baptism the portal knows about that the Baptisms (MLC) sheet
 * doesn't (an STL deleted the row, a late confirmation, etc.). Written as
 * `source='portal'`, so the sheet sync never touches it. Authoritative
 * (`confidence` NULL) — it counts in reconciliation like a sheet row.
 *
 * Returns `{ duplicate: true, id }` without inserting when an active friend
 * already has the same folded name + date, so a double-submit is a no-op.
 */
export async function recordBaptism(
  db: D1Database,
  actor: string,
  input: RecordInput,
): Promise<{ id: string; duplicate: boolean }> {
  const name = norm(input.name);
  const date = toIsoDate(input.baptismDate);
  if (!name) throw new Error("name is required");
  if (!date) throw new Error("a valid baptism date is required");

  const existing = await listFriends(db, { includeInactive: true });
  const wn = wnKeyOf(norm(input.ward) || null, name);
  const dup = existing.find(
    (f) =>
      f.baptizedConfirmed &&
      f.baptismDate === date &&
      (wnKeyOf(f.ward, f.name) === wn || fold(f.name) === fold(name)),
  );
  if (dup) return { id: dup.id, duplicate: true };

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO friend (id, name, zone, ward, stake, missionaries, baptism_date,
         baptism_time, baptism_address, attended_church_2x, on_baptism_calendar,
         baptized_confirmed, confirmed_at, confidence, notes, dropped, active, source,
         sync_key, created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, 1, 1, ?, NULL, ?, 0, 1, 'portal',
         NULL, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      name,
      norm(input.zone) || null,
      norm(input.ward) || null,
      norm(input.stake) || null,
      norm(input.missionaries) || null,
      date,
      date,
      norm(input.notes) || null,
      now,
      actor,
      now,
      actor,
    )
    .run();
  return { id, duplicate: false };
}

// --- sheet sync -----------------------------------------------------------
export interface SheetRow {
  zone?: string;
  name?: string;
  ward?: string;
  stake?: string;
  missionaries?: string;
  baptismDate?: string;
  baptismTime?: string;
  baptismAddress?: string;
  attendedChurch2x?: unknown;
  onBaptismCalendar?: unknown;
  baptizedConfirmed?: unknown;
}

const norm = (s: unknown) => String(s ?? "").trim();

/** Fold accents + inner whitespace so cosmetic edits don't create a new key. */
function fold(s: string): string {
  return String(s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
/** ward|name — the reschedule-tolerant match key (date may change). */
export function wnKeyOf(ward: string | null, name: string): string {
  return `${fold(ward ?? "")}|${fold(name)}`;
}
/** ward|name|date — the exact match key. */
export function fullKeyOf(ward: string | null, name: string, date: string | null): string {
  return `${wnKeyOf(ward, name)}|${date ?? ""}`;
}

export async function syncFriends(
  db: D1Database,
  rows: SheetRow[],
  weekStart: string | null,
): Promise<{
  rowsIn: number;
  upserted: number;
  changed: number;
  retained: number;
  deactivated: number;
  warnings: string[];
}> {
  const warnings: string[] = [];
  const now = new Date().toISOString();

  // normalise + key, drop nameless rows
  const clean = rows
    .map((r) => {
      const name = norm(r.name);
      const zone = norm(r.zone);
      const ward = norm(r.ward);
      const baptismDate = toIsoDate(r.baptismDate);
      return {
        wn: wnKeyOf(ward, name),
        full: fullKeyOf(ward, name, baptismDate),
        name,
        zone: zone || null,
        ward: ward || null,
        stake: norm(r.stake) || null,
        missionaries: norm(r.missionaries) || null,
        baptismDate,
        baptismTime: cleanTime(r.baptismTime),
        baptismAddress: norm(r.baptismAddress) || null,
        attendedChurch2x: yn(r.attendedChurch2x),
        onBaptismCalendar: yn(r.onBaptismCalendar),
        baptizedConfirmed: yn(r.baptizedConfirmed),
      };
    })
    .filter((r) => {
      if (!r.name) return false;
      if (!r.baptismDate && !r.baptizedConfirmed) {
        warnings.push(`"${r.name}" has no baptism date and isn't marked baptized; skipped`);
        return false;
      }
      return true;
    });

  // dedupe the snapshot on the exact key (a true duplicate entry collapses)
  const snap = new Map<string, (typeof clean)[number]>();
  for (const r of clean) snap.set(r.full, r);

  const existing = await listFriends(db, { includeInactive: true });
  const sheetRows = existing.filter((f) => f.source === "sheet");

  // Index existing sheet rows two ways
  const byFull = new Map<string, StoredFriend>();
  const byWn = new Map<string, StoredFriend[]>();
  for (const f of sheetRows) {
    byFull.set(fullKeyOf(f.ward, f.name, f.baptismDate), f);
    const wn = wnKeyOf(f.ward, f.name);
    const list = byWn.get(wn);
    if (list) list.push(f);
    else byWn.set(wn, [f]);
  }

  let upserted = 0;
  let changed = 0;
  const stmts: D1PreparedStatement[] = [];
  const claimed = new Set<string>(); // friend ids matched this run

  const differs = (a: (typeof clean)[number], b: StoredFriend) =>
    a.name !== b.name ||
    a.zone !== (b.zone ?? null) ||
    a.ward !== (b.ward ?? null) ||
    a.stake !== (b.stake ?? null) ||
    a.missionaries !== (b.missionaries ?? null) ||
    a.baptismDate !== (b.baptismDate ?? null) ||
    a.baptismTime !== (b.baptismTime ?? null) ||
    a.baptismAddress !== (b.baptismAddress ?? null) ||
    a.attendedChurch2x !== b.attendedChurch2x ||
    a.onBaptismCalendar !== b.onBaptismCalendar ||
    a.baptizedConfirmed !== b.baptizedConfirmed ||
    !b.active ||
    b.dropped;

  for (const r of snap.values()) {
    // tier 1: exact ward|name|date; tier 2: the one unclaimed ward|name (a reschedule)
    let prev = byFull.get(r.full);
    if (prev && claimed.has(prev.id)) prev = undefined;
    if (!prev) {
      const cand = (byWn.get(r.wn) ?? []).filter((f) => !claimed.has(f.id));
      if (cand.length === 1) prev = cand[0];
    }

    if (prev) {
      claimed.add(prev.id);
      if (differs(r, prev)) changed++;
      stmts.push(
        db
          .prepare(
            `UPDATE friend SET name=?, zone=?, ward=?, stake=?, missionaries=?, baptism_date=?,
               baptism_time=?, baptism_address=?, attended_church_2x=?, on_baptism_calendar=?,
               baptized_confirmed=?,
               confirmed_at = CASE WHEN ? = 1 AND baptized_confirmed = 0 THEN ? ELSE confirmed_at END,
               active=1, dropped=0, left_sheet_at=NULL, source='sheet', sync_key=?,
               updated_at=?, updated_by='sheet-sync'
             WHERE id=?`,
          )
          .bind(
            r.name, r.zone, r.ward, r.stake, r.missionaries, r.baptismDate, r.baptismTime,
            r.baptismAddress, r.attendedChurch2x ? 1 : 0, r.onBaptismCalendar ? 1 : 0,
            r.baptizedConfirmed ? 1 : 0, r.baptizedConfirmed ? 1 : 0, now, r.full, now, prev.id,
          ),
      );
    } else {
      stmts.push(
        db
          .prepare(
            `INSERT INTO friend (id, name, zone, ward, stake, missionaries, baptism_date,
               baptism_time, baptism_address, attended_church_2x, on_baptism_calendar,
               baptized_confirmed, confirmed_at, dropped, active, source, sync_key, created_at,
               created_by, updated_at, updated_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 'sheet', ?, ?, 'sheet-sync', ?, 'sheet-sync')`,
          )
          .bind(
            crypto.randomUUID(), r.name, r.zone, r.ward, r.stake, r.missionaries, r.baptismDate,
            r.baptismTime, r.baptismAddress, r.attendedChurch2x ? 1 : 0, r.onBaptismCalendar ? 1 : 0,
            r.baptizedConfirmed ? 1 : 0, r.baptizedConfirmed ? now : null, r.full, now, now,
          ),
      );
      changed++;
    }
    upserted++;
  }

  // sheet rows nobody claimed: STLs cycle completed baptisms out each month, so
  // keep those (stamp when they left); an on-date friend removed = not progressing.
  const gone = sheetRows.filter((f) => f.active && !claimed.has(f.id));
  let retained = 0;
  let deactivated = 0;
  for (const f of gone) {
    if (f.baptizedConfirmed) {
      if (f.leftSheetAt == null) {
        stmts.push(
          db
            .prepare(
              "UPDATE friend SET left_sheet_at=?, updated_at=?, updated_by='sheet-sync' WHERE id=?",
            )
            .bind(now, now, f.id),
        );
      }
      retained++;
    } else {
      stmts.push(
        db
          .prepare(
            "UPDATE friend SET active=0, dropped=1, updated_at=?, updated_by='sheet-sync' WHERE id=?",
          )
          .bind(now, f.id),
      );
      deactivated++;
    }
  }

  // run in chunks
  for (let i = 0; i < stmts.length; i += 20) await db.batch(stmts.slice(i, i + 20));

  // weekly snapshot — only when something moved (idempotent UPSERT keyed by week)
  if (weekStart && (changed > 0 || deactivated > 0)) {
    const activeNow = await listFriends(db);
    const weekStmts = activeNow.map((f) =>
      db
        .prepare(
          `INSERT INTO friend_week (friend_id, week_start, baptism_date, attended_church_2x,
             on_baptism_calendar, baptized_confirmed, dropped, captured_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (friend_id, week_start) DO UPDATE SET
             baptism_date=excluded.baptism_date, attended_church_2x=excluded.attended_church_2x,
             on_baptism_calendar=excluded.on_baptism_calendar,
             baptized_confirmed=excluded.baptized_confirmed, dropped=excluded.dropped,
             captured_at=excluded.captured_at`,
        )
        .bind(
          f.id, weekStart, f.baptismDate, f.attendedChurch2x ? 1 : 0, f.onBaptismCalendar ? 1 : 0,
          f.baptizedConfirmed ? 1 : 0, f.dropped ? 1 : 0, now,
        ),
    );
    for (let i = 0; i < weekStmts.length; i += 20) await db.batch(weekStmts.slice(i, i + 20));
  }

  await db
    .prepare(
      "INSERT INTO friend_sync (at, rows_in, upserted, deactivated, warnings) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(now, rows.length, upserted, deactivated, warnings.length ? JSON.stringify(warnings) : null)
    .run();

  return { rowsIn: rows.length, upserted, changed, retained, deactivated, warnings };
}
