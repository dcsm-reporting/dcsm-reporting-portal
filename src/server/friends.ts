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
  dedupeBaptized,
  isOnDate,
  isSheetError,
  stakeForFriend,
  summarise,
  toIsoDate,
  yn,
  type Friend,
  type FriendsSummary,
} from "../pipeline/friends.js";
import { getAreaWardRows, getConfig, setConfig } from "./db.js";
import { wardMapForWeek } from "../pipeline/resolve.js";
import { addMonthsClamped, mondayOf, recentMonthKeys, todayIso } from "../shared/dates.js";

/**
 * ward(lower) → stake and the set of known stakes, from the ward→stake rows
 * effective on `week`. Shared by every "which stake does this friend belong
 * to" caller so they all agree.
 */
export function stakeLookup(
  areaWard: Awaited<ReturnType<typeof getAreaWardRows>>,
  week: string,
): { stakeOfWard: Map<string, string>; knownStakes: string[] } {
  const stakeOfWard = new Map<string, string>();
  const known = new Set<string>();
  for (const [, [wardName, stake]] of wardMapForWeek(areaWard, week)) {
    stakeOfWard.set(wardName.toLowerCase(), stake);
    known.add(stake);
  }
  // stakes that only appear in older rows still count as known spellings
  for (const r of areaWard) known.add(r.stake);
  return { stakeOfWard, knownStakes: [...known] };
}

type Row = Record<string, string | number | null>;
export type StoredFriend = Friend & {
  active: boolean;
  syncKey: string | null;
  leftSheetAt: string | null;
  /** columns on the sheet the portal has no named field for, {header: value} */
  extra: Record<string, string>;
};

const COLS =
  "id, name, zone, canonical_area_key, ward, stake, missionaries, baptism_date, baptism_time, " +
  "baptism_address, attended_church_2x, on_baptism_calendar, baptized_confirmed, dropped, active, " +
  "left_sheet_at, confirmed_at, confidence, notes, source, sync_key, created_at, created_by, " +
  "updated_at, updated_by, extra_json";

function parseExtra(v: unknown): Record<string, string> {
  if (typeof v !== "string" || !v) return {};
  try {
    const o = JSON.parse(v);
    return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, string>) : {};
  } catch {
    return {};
  }
}
/** Stable JSON (sorted keys) so "unchanged" compares equal. */
function extraJson(extra: Record<string, string> | undefined | null): string | null {
  if (!extra) return null;
  const keys = Object.keys(extra)
    .filter((k) => k.trim() && String(extra[k] ?? "").trim())
    .sort();
  if (!keys.length) return null;
  const o: Record<string, string> = {};
  for (const k of keys.slice(0, 40)) o[k.trim().slice(0, 80)] = String(extra[k]).trim().slice(0, 200);
  return JSON.stringify(o);
}

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
    extra: parseExtra(r.extra_json),
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
  // Baptized: most recent first, so today's sheet surfaces above last year's
  // backfill instead of under it. On-date / all: soonest date first (still
  // actionable planning order).
  const order =
    opts.status === "baptized"
      ? "baptism_date IS NULL, baptism_date DESC, name"
      : "baptized_confirmed, baptism_date IS NULL, baptism_date, name";
  const sql =
    `SELECT ${COLS} FROM friend` +
    (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
    ` ORDER BY ${order}`;
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
): Promise<FriendsSummary & { lastSyncedAt: string | null; lastSyncWarnings: string[] }> {
  const [friends, lastSync] = await Promise.all([
    listFriends(db),
    db
      .prepare("SELECT at, warnings FROM friend_sync ORDER BY id DESC LIMIT 1")
      .first<{ at: string; warnings: string | null }>(),
  ]);
  let lastSyncWarnings: string[] = [];
  try {
    const w = lastSync?.warnings ? JSON.parse(lastSync.warnings) : [];
    // only the structural ones matter here (a renamed column, a held-back pass);
    // per-row skips are routine
    lastSyncWarnings = (Array.isArray(w) ? w : []).filter(
      (s: unknown) => typeof s === "string" && /renamed on the sheet|held back/.test(s),
    );
  } catch {
    /* ignore */
  }
  return { ...summarise(friends, weekStart), lastSyncedAt: lastSync?.at ?? null, lastSyncWarnings };
}

/**
 * Per-stake lists for the Stakes page / stake-president report:
 *   onDate    — everyone currently on a baptismal date
 *   baptized  — baptized in the last 6 months (matches the old report's page 2)
 */
export async function friendsByStake(db: D1Database, weekStart: string) {
  const friends = await listFriends(db);
  const { stakeOfWard, knownStakes } = stakeLookup(await getAreaWardRows(db), weekStart);
  const sixMonthsAgo = addMonthsClamped(weekStart, -6);

  const byStake: Record<string, { onDate: Friend[]; baptized: Friend[] }> = {};
  const bucket = (s: string) => (byStake[s] ??= { onDate: [], baptized: [] });

  for (const f of friends) {
    const stake = stakeForFriend(f, knownStakes, stakeOfWard);
    if (isOnDate(f)) bucket(stake).onDate.push(f);
    if (f.baptizedConfirmed && (f.baptismDate ?? "") >= sixMonthsAgo) {
      bucket(stake).baptized.push(f);
    }
  }
  for (const g of Object.values(byStake)) {
    g.onDate.sort((a, b) => (a.baptismDate ?? "").localeCompare(b.baptismDate ?? ""));
    g.baptized = dedupeBaptized(g.baptized).sort((a, b) =>
      (b.baptismDate ?? "").localeCompare(a.baptismDate ?? ""),
    );
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
  const keys = recentMonthKeys(months, todayIso());
  const earliest = keys[0]!;
  const { results } = await db
    .prepare(
      `SELECT name, baptism_date, confidence, source
       FROM friend WHERE baptized_confirmed = 1 AND baptism_date >= ?`,
    )
    .bind(`${earliest}-01`)
    .all<{ name: string; baptism_date: string; confidence: string | null; source: string }>();

  const rows = dedupeBaptized(
    (results ?? []).map((r) => ({
      name: r.name,
      baptismDate: r.baptism_date,
      confidence: r.confidence,
      source: r.source,
    })),
  );
  const conf = (c: string | null) => c === null || c === "confirmed";
  return keys.map((month) => {
    const inM = rows.filter((r) => (r.baptismDate ?? "").startsWith(month));
    return {
      month,
      confirmed: inM.filter((r) => conf(r.confidence)).length,
      unverified: inM.filter((r) => !conf(r.confidence)).length,
    };
  });
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

/**
 * Deliberately correct a completed baptism that shouldn't count — it never
 * happened, was a duplicate, or wasn't a convert baptism (e.g. a ward
 * baptism). This is the human, audited counterpart to the passive sheet-sync
 * retention: a row leaving the sheet is *assumed* to mean "cycled out, still
 * counts"; this is the deliberate override for "it left because it was
 * wrong". Un-confirms and deactivates the record but keeps it — with the
 * reason recorded — rather than deleting it, so the history survives. Works
 * on any source (sheet, portal, or legacy backfill), not just portal rows.
 */
export async function correctBaptism(
  db: D1Database,
  actor: string,
  id: string,
  reason: string,
): Promise<{ name: string }> {
  const f = await getFriend(db, id);
  if (!f) throw new Error("no such record");
  if (!f.baptizedConfirmed) throw new Error("that record isn't marked baptized");
  const trimmed = reason.trim();
  if (!trimmed) throw new Error("a reason is required");
  const now = new Date().toISOString();
  const note = `Corrected ${now.slice(0, 10)} by ${actor}: ${trimmed}`;
  await db
    .prepare(
      `UPDATE friend SET baptized_confirmed = 0, active = 0, dropped = 1,
         notes = CASE WHEN notes IS NULL OR notes = '' THEN ? ELSE notes || char(10) || ? END,
         updated_at = ?, updated_by = ?
       WHERE id = ?`,
    )
    .bind(note, note, now, actor, id)
    .run();
  return { name: f.name };
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
  /** every other column on the sheet, {header: value} */
  extra?: Record<string, unknown>;
}

/** The sheet columns the portal depends on; a sync with none of them warns loudly. */
const CORE_COLUMNS: { field: keyof SheetRow; header: string }[] = [
  { field: "ward", header: "Ward Name" },
  { field: "stake", header: "Stake" },
  { field: "baptismDate", header: "Baptism Date" },
];

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

/**
 * Apply a full snapshot of the sheet. `weekStart` overrides the week the
 * snapshot is filed under (tests / backfills); normally leave it null and the
 * current week (mission tz) is used.
 */
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
  rejected?: boolean;
}> {
  const warnings: string[] = [];
  const now = new Date().toISOString();
  let skippedJunk = 0;

  // Columns the portal has no named field for are kept only if the mission
  // listed them (Admin → Reporting settings). The header *names* seen are
  // recorded so the office can decide; the values are dropped otherwise.
  const keepExtra = new Set(
    (await getConfig<string[]>(db, "sheet_extra_columns", [])).map((s) => String(s).trim()),
  );
  const headersSeen = new Set<string>();

  // normalise + key, drop nameless rows. A formula-driven cell can push a
  // spreadsheet error token (#REF!, #N/A …) through as if it were text; those
  // are blanked field-by-field and a row whose *name* is one is dropped.
  const clean = rows
    .map((r) => {
      const scrub = (v: unknown) => (isSheetError(v) ? "" : v);
      const name = isSheetError(r.name) ? "" : norm(r.name);
      const zone = norm(scrub(r.zone));
      const ward = norm(scrub(r.ward));
      const baptismDate = isSheetError(r.baptismDate) ? null : toIsoDate(r.baptismDate);
      r = {
        ...r,
        stake: norm(scrub(r.stake)),
        missionaries: norm(scrub(r.missionaries)),
        baptismTime: norm(scrub(r.baptismTime)),
        baptismAddress: norm(scrub(r.baptismAddress)),
      };
      const extraIn: Record<string, string> = {};
      if (r.extra && typeof r.extra === "object") {
        for (const [k, v] of Object.entries(r.extra)) {
          const key = k.trim();
          if (!key) continue;
          headersSeen.add(key);
          if (!keepExtra.has(key)) continue;
          if (isSheetError(v)) continue;
          const s = norm(v);
          if (s) extraIn[key] = s;
        }
      }
      const extra = extraJson(extraIn);
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
        extra,
      };
    })
    .filter((r) => {
      if (!r.name) {
        skippedJunk++;
        return false;
      }
      if (!r.baptismDate && !r.baptizedConfirmed) {
        warnings.push(`"${r.name}" has no baptism date and isn't marked baptized; skipped`);
        return false;
      }
      return true;
    });

  if (skippedJunk > 0) {
    warnings.push(
      `${skippedJunk} row(s) had a blank name or a spreadsheet error (#REF!, #N/A) in the name column; skipped`,
    );
  }
  // A renamed header on the sheet makes a core field silently blank on every
  // row. Say so, because the stake reports depend on it.
  if (rows.length >= 5) {
    for (const col of CORE_COLUMNS) {
      const present = rows.filter((r) => norm(r[col.field]) !== "").length;
      if (present === 0) {
        warnings.push(
          `no row carried a value for "${col.header}" — was that column renamed on the sheet? ` +
            `The script maps columns by header text (see FIELD_BY_HEADER in baptisms-sync.gs).`,
        );
      }
    }
  }

  // remember new header names (names only) so the office can choose to keep them
  if (headersSeen.size > 0) {
    const known = await getConfig<string[]>(db, "sheet_extra_headers_seen", []);
    const merged = [...new Set([...known, ...headersSeen])].sort();
    if (merged.length !== known.length) await setConfig(db, "sheet_extra_headers_seen", merged);
  }

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
  let inserted = 0;
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
    a.extra !== extraJson(b.extra) ||
    a.full !== (b.syncKey ?? null) ||
    b.leftSheetAt != null ||
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
      upserted++;
      // Only write when something actually differs. Rewriting every row on
      // every 15-minute tick burned ~10k D1 writes a day and stamped
      // updated_at on rows nothing had touched, which made "when did this
      // record last change" meaningless.
      if (!differs(r, prev)) continue;
      changed++;
      stmts.push(
        db
          .prepare(
            `UPDATE friend SET name=?, zone=?, ward=?, stake=?, missionaries=?, baptism_date=?,
               baptism_time=?, baptism_address=?, attended_church_2x=?, on_baptism_calendar=?,
               baptized_confirmed=?,
               confirmed_at = CASE WHEN ? = 1 AND baptized_confirmed = 0 THEN ? ELSE confirmed_at END,
               active=1, dropped=0, left_sheet_at=NULL, source='sheet', sync_key=?, extra_json=?,
               updated_at=?, updated_by='sheet-sync'
             WHERE id=?`,
          )
          .bind(
            r.name, r.zone, r.ward, r.stake, r.missionaries, r.baptismDate, r.baptismTime,
            r.baptismAddress, r.attendedChurch2x ? 1 : 0, r.onBaptismCalendar ? 1 : 0,
            r.baptizedConfirmed ? 1 : 0, r.baptizedConfirmed ? 1 : 0, now, r.full, r.extra, now, prev.id,
          ),
      );
    } else {
      stmts.push(
        db
          .prepare(
            `INSERT INTO friend (id, name, zone, ward, stake, missionaries, baptism_date,
               baptism_time, baptism_address, attended_church_2x, on_baptism_calendar,
               baptized_confirmed, confirmed_at, dropped, active, source, sync_key, extra_json, created_at,
               created_by, updated_at, updated_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 'sheet', ?, ?, ?, 'sheet-sync', ?, 'sheet-sync')`,
          )
          .bind(
            crypto.randomUUID(), r.name, r.zone, r.ward, r.stake, r.missionaries, r.baptismDate,
            r.baptismTime, r.baptismAddress, r.attendedChurch2x ? 1 : 0, r.onBaptismCalendar ? 1 : 0,
            r.baptizedConfirmed ? 1 : 0, r.baptizedConfirmed ? now : null, r.full, r.extra, now, now,
          ),
      );
      changed++;
      inserted++;
      upserted++;
    }
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

  // Circuit breaker: a sort, a cut-paste, or a sync landing mid-edit can make a
  // burst of rows look like they simultaneously vanished and reappeared under
  // slightly different text. That shows up as inserts + drops happening
  // together — unlike the normal monthly clear-out, where STLs remove a batch
  // of *confirmed* baptisms and those are retained, not dropped, so they don't
  // count here. If inserts+drops are large relative to the active sheet
  // population, something looks off: apply nothing and report it instead of
  // guessing.
  const activeBefore = sheetRows.filter((f) => f.active).length;
  const identityChurn = inserted + deactivated;
  // Below a real baseline there's nothing to compare against — a first-ever
  // sync, or one after a reset, is supposed to insert a lot of rows at once.
  const MIN_BASELINE = 10;
  const churnLimit = Math.max(8, Math.round(activeBefore * 0.3));
  if (activeBefore >= MIN_BASELINE && identityChurn > churnLimit) {
    const msg =
      `sync held back: ${inserted} new + ${deactivated} dropped (of ${activeBefore} active) in one pass ` +
      `looks like a mid-edit or a sort, not real changes; nothing was applied. Re-run once the sheet settles.`;
    warnings.push(msg);
    await db
      .prepare(
        "INSERT INTO friend_sync (at, rows_in, upserted, deactivated, warnings) VALUES (?, ?, 0, 0, ?)",
      )
      .bind(now, rows.length, JSON.stringify(warnings))
      .run();
    return { rowsIn: rows.length, upserted: 0, changed: 0, retained: 0, deactivated: 0, warnings, rejected: true };
  }

  // run in chunks
  for (let i = 0; i < stmts.length; i += 20) await db.batch(stmts.slice(i, i + 20));

  // Weekly snapshot of the sheet's state, keyed by the Monday of the week the
  // sync lands in (mission tz) — "as of week X". Written when something moved,
  // and at least once per week even when nothing did, so a quiet week is not
  // a missing week in the history. Idempotent UPSERT keyed by (friend, week).
  const snapWeek = weekStart ?? mondayOf(todayIso());
  const haveSnapshot = await db
    .prepare("SELECT 1 FROM friend_week WHERE week_start = ? LIMIT 1")
    .bind(snapWeek)
    .first();
  if (changed > 0 || deactivated > 0 || !haveSnapshot) {
    const weekStart = snapWeek;
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

  await db.batch([
    db
      .prepare(
        "INSERT INTO friend_sync (at, rows_in, upserted, deactivated, warnings) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(now, rows.length, upserted, deactivated, warnings.length ? JSON.stringify(warnings) : null),
    // The 15-minute timer writes ~35k log rows a year. Only the recent ones
    // matter (freshness + a few weeks of "what happened"); keep 120 days.
    db
      .prepare("DELETE FROM friend_sync WHERE at < ?")
      .bind(new Date(Date.now() - 120 * 86_400_000).toISOString()),
  ]);

  return { rowsIn: rows.length, upserted, changed, retained, deactivated, warnings };
}
