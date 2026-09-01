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
export type StoredFriend = Friend & { active: boolean; syncKey: string | null };

const COLS =
  "id, name, zone, canonical_area_key, ward, stake, missionaries, baptism_date, baptism_time, " +
  "baptism_address, attended_church_2x, on_baptism_calendar, baptized_confirmed, dropped, active, " +
  "source, sync_key, created_at, created_by, updated_at, updated_by";

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
    dropped: Boolean(r.dropped),
    source: (r.source as "sheet" | "portal") ?? "portal",
    createdAt: r.created_at as string,
    createdBy: (r.created_by as string | null) ?? null,
    updatedAt: r.updated_at as string,
    updatedBy: (r.updated_by as string | null) ?? null,
    active: Boolean(r.active),
    syncKey: (r.sync_key as string | null) ?? null,
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
export function syncKeyOf(zone: string, ward: string, name: string): string {
  return `${norm(zone)}|${norm(ward)}|${norm(name)}`.toLowerCase();
}

export async function syncFriends(
  db: D1Database,
  rows: SheetRow[],
  weekStart: string | null,
): Promise<{
  rowsIn: number;
  upserted: number;
  changed: number;
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
      return {
        key: syncKeyOf(zone, ward, name),
        name,
        zone: zone || null,
        ward: ward || null,
        stake: norm(r.stake) || null,
        missionaries: norm(r.missionaries) || null,
        baptismDate: toIsoDate(r.baptismDate),
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
        warnings.push(`"${r.name}" has no baptism date and isn't marked baptized — skipped`);
        return false;
      }
      return true;
    });

  // dedupe within the snapshot (last wins)
  const byKey = new Map<string, (typeof clean)[number]>();
  for (const r of clean) byKey.set(r.key, r);

  const existing = await listFriends(db, { includeInactive: true });
  const existingByKey = new Map(existing.filter((f) => f.syncKey).map((f) => [f.syncKey!, f]));

  let upserted = 0;
  let changed = 0;
  const stmts: D1PreparedStatement[] = [];

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
    !b.active;

  for (const r of byKey.values()) {
    const prev = existingByKey.get(r.key);
    if (prev) {
      if (differs(r, prev)) changed++;
      stmts.push(
        db
          .prepare(
            `UPDATE friend SET name=?, zone=?, ward=?, stake=?, missionaries=?, baptism_date=?,
               baptism_time=?, baptism_address=?, attended_church_2x=?, on_baptism_calendar=?,
               baptized_confirmed=?, active=1, source='sheet', updated_at=?, updated_by='sheet-sync'
             WHERE id=?`,
          )
          .bind(
            r.name, r.zone, r.ward, r.stake, r.missionaries, r.baptismDate, r.baptismTime,
            r.baptismAddress, r.attendedChurch2x ? 1 : 0, r.onBaptismCalendar ? 1 : 0,
            r.baptizedConfirmed ? 1 : 0, now, prev.id,
          ),
      );
    } else {
      stmts.push(
        db
          .prepare(
            `INSERT INTO friend (id, name, zone, ward, stake, missionaries, baptism_date,
               baptism_time, baptism_address, attended_church_2x, on_baptism_calendar,
               baptized_confirmed, dropped, active, source, sync_key, created_at, created_by,
               updated_at, updated_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 'sheet', ?, ?, 'sheet-sync', ?, 'sheet-sync')`,
          )
          .bind(
            crypto.randomUUID(), r.name, r.zone, r.ward, r.stake, r.missionaries, r.baptismDate,
            r.baptismTime, r.baptismAddress, r.attendedChurch2x ? 1 : 0, r.onBaptismCalendar ? 1 : 0,
            r.baptizedConfirmed ? 1 : 0, r.key, now, now,
          ),
      );
      changed++;
    }
    upserted++;
  }

  // anyone active + sheet-sourced who dropped out of the snapshot → deactivate
  const gone = existing.filter(
    (f) => f.source === "sheet" && (f as Friend & { active: boolean }).active && f.syncKey && !byKey.has(f.syncKey),
  );
  for (const f of gone) {
    stmts.push(
      db.prepare("UPDATE friend SET active=0, updated_at=?, updated_by='sheet-sync' WHERE id=?").bind(now, f.id),
    );
  }

  // run in chunks
  for (let i = 0; i < stmts.length; i += 20) await db.batch(stmts.slice(i, i + 20));

  // weekly snapshot — only when something moved (idempotent UPSERT keyed by week)
  if (weekStart && (changed > 0 || gone.length > 0)) {
    const active = await listFriends(db);
    const snap = active.map((f) =>
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
    for (let i = 0; i < snap.length; i += 20) await db.batch(snap.slice(i, i + 20));
  }

  await db
    .prepare(
      "INSERT INTO friend_sync (at, rows_in, upserted, deactivated, warnings) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(now, rows.length, upserted, gone.length, warnings.length ? JSON.stringify(warnings) : null)
    .run();

  return { rowsIn: rows.length, upserted, changed, deactivated: gone.length, warnings };
}
