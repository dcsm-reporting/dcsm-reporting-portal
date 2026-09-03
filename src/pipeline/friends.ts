/**
 * Friends / on-date helpers — pure. Shared by the server and the legacy import.
 */

import { addDays, calendarWeekOf, monthOf, todayIso } from "../shared/dates.js";

/**
 * Spreadsheet error tokens (#REF!, #N/A, …) that a formula-driven Baptisms
 * (MLC) sheet can leave in a name or date cell. They are never data.
 */
const SHEET_ERROR = /^#(REF!|N\/A|VALUE!|DIV\/0!|NAME\?|NUM!|NULL!|ERROR!)$/i;
export function isSheetError(v: unknown): boolean {
  return SHEET_ERROR.test(String(v ?? "").trim());
}

/**
 * Match a free-text stake name (as typed on the sheet) to one of the stakes
 * the crosswalk knows. Case-insensitive, ignores a trailing "Stake", accents
 * and extra whitespace. Returns the canonical spelling, or null.
 */
export function matchStake(text: string | null | undefined, known: Iterable<string>): string | null {
  const key = stakeKey(text);
  if (!key) return null;
  for (const k of known) if (stakeKey(k) === key) return k;
  return null;
}
function stakeKey(s: string | null | undefined): string {
  return String(s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\bstake\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export const UNASSIGNED_STAKE = "(unassigned)";

/**
 * Which stake a friend belongs to for reporting: the sheet's stake column
 * (matched tolerantly against the known stakes), else the stake of the ward
 * named on the sheet, else "(unassigned)" so the caller can surface it.
 */
export function stakeForFriend(
  f: { stake: string | null; ward: string | null },
  knownStakes: Iterable<string>,
  stakeOfWard: Map<string, string>,
): string {
  const known = [...knownStakes];
  const byText = matchStake(f.stake, known);
  if (byText) return byText;
  const byWard = stakeOfWard.get((f.ward ?? "").trim().toLowerCase());
  if (byWard) return byWard;
  // an unknown spelling is still a stake name the STL wrote; keep it visible
  // rather than folding it into "(unassigned)" and losing the information
  const raw = String(f.stake ?? "").trim();
  return raw || UNASSIGNED_STAKE;
}

export interface Friend {
  id: string;
  name: string;
  zone: string | null;
  canonicalAreaKey: string | null;
  ward: string | null;
  stake: string | null;
  missionaries: string | null;
  baptismDate: string | null; // YYYY-MM-DD
  baptismTime: string | null;
  baptismAddress: string | null;
  attendedChurch2x: boolean;
  onBaptismCalendar: boolean;
  baptizedConfirmed: boolean;
  confirmedAt: string | null;
  /** 'confirmed' | 'unverified' for legacy backfill; null for sheet-sourced. */
  confidence: string | null;
  notes: string | null;
  dropped: boolean;
  source: string; // 'sheet' | 'portal' | a granular legacy source list
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

export type FriendInput = Partial<
  Pick<
    Friend,
    | "name"
    | "zone"
    | "canonicalAreaKey"
    | "ward"
    | "stake"
    | "missionaries"
    | "baptismDate"
    | "baptismTime"
    | "baptismAddress"
    | "attendedChurch2x"
    | "onBaptismCalendar"
    | "baptizedConfirmed"
    | "dropped"
  >
>;

/** "Y", "yes", true, 1 → true; everything else → false. */
export function yn(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === "number") return v === 1;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "y" || s === "yes" || s === "true" || s === "1" || s === "x";
}

/**
 * A friend counts toward "On Date" when they have a baptism date, aren't yet
 * confirmed, and haven't been dropped. (Per Mission Presidency direction the
 * stake-report On Date figure is the count of these named records, not IMOS
 * id-30.)
 */
export function isOnDate(f: Pick<Friend, "baptismDate" | "baptizedConfirmed" | "dropped">): boolean {
  return f.baptismDate != null && f.baptismDate !== "" && !f.baptizedConfirmed && !f.dropped;
}

/** Normalise a date-ish value to YYYY-MM-DD, or null. Accepts Date, ISO, m/d/yy. */
export function toIsoDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    let [, mm, dd, yy] = m;
    const y = yy!.length === 2 ? `20${yy}` : yy!;
    return `${y}-${mm!.padStart(2, "0")}-${dd!.padStart(2, "0")}`;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

/**
 * Tidy a baptism-time cell. Google Sheets time-only cells arrive as a full
 * datetime ("Sat Dec 30 1899 10:00:00 GMT-0500 …" or an ISO string); pull just
 * the clock time as "h:mm AM/PM". Plain strings ("TBD", "2:00 PM") pass through.
 */
export function cleanTime(v: unknown): string | null {
  if (v == null || v === "") return null;
  let s = String(v).trim();
  if (!s || /^tbd$/i.test(s)) return s || null;

  // "Sat Dec 30 1899 10:00:00 GMT-0500 (Eastern Standard Time)" or ISO datetime
  const dm = s.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i);
  const looksLikeDatetime = /\b(18|19|20)\d\d\b/.test(s) || /GMT|T\d\d:\d\d/.test(s);
  if (looksLikeDatetime && dm) {
    let h = parseInt(dm[1]!, 10);
    const min = dm[2]!;
    let ap = dm[3]?.toUpperCase();
    if (!ap) {
      ap = h >= 12 ? "PM" : "AM";
      if (h > 12) h -= 12;
    }
    if (h === 0) h = 12;
    return `${h}:${min} ${ap}`;
  }
  // already a short time like "2:00PM" → normalise the space
  const short = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (short) return `${parseInt(short[1]!, 10)}:${short[2]} ${short[3]!.toUpperCase()}`;
  return s;
}

/** "Elders Zhou & Lake" / "Sisters Hansen & Elton & Wolfley" → ["Zhou","Lake",…] */
export function missionaryLastNames(s: string | null | undefined): string[] {
  if (!s) return [];
  return s
    .replace(/^\s*(elders?|sisters?|senior missionaries?)\s+/i, "")
    .split(/\s*&\s*|\s*,\s*/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export interface FriendsSummary {
  onDateTotal: number;
  onDateThisWeek: number;
  /** on a date that has already passed and still not marked baptized */
  overdueCount: number;
  baptizedThisMonth: number; // confirmed tier
  baptizedThisMonthUnverified: number; // Zone-Leader-form-only legacy
  calendarYes: number;
  calendarNo: number;
  church2xYes: number;
  church2xNo: number;
  /** the window the "this week" / "this month" figures are measured over */
  weekStart: string;
  weekEnd: string;
  month: string;
}

/** confirmed tier = sheet-sourced (null) or corroborated legacy. */
const confirmedTier = (c: string | null) => c === null || c === "confirmed";

/**
 * A name key that ignores order, accents, punctuation and any parenthetical
 * (e.g. a Chinese name): "Li Ping Yan" and "Yan Li Ping(颜利平)" produce the
 * same key.
 */
export function nameKey(name: string): string {
  return String(name ?? "")
    .replace(/\([^)]*\)/g, " ")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

/** name + date key (kept for callers that want an exact person+date bucket). */
export function personKey(name: string, date: string | null): string {
  return `${date ?? ""}|${nameKey(name)}`;
}

const DUP_WINDOW_DAYS = 45;

/**
 * Collapse duplicate baptism records for the same person. Two records merge
 * when the folded name matches AND the baptism dates are within ~6 weeks —
 * that catches the legacy case where one source has the confirmation date and
 * another the scheduled date. Keeps the row with the most corroborating
 * sources, then the one synced from the sheet, then the earliest date.
 */
export function dedupeBaptized<T extends { name: string; baptismDate: string | null; source: string }>(
  rows: T[],
): T[] {
  const weight = (r: T) => (r.source === "sheet" ? 100 : r.source.split("+").length);
  const dayNum = (d: string | null) => (d ? Date.parse(`${d}T00:00:00Z`) / 86_400_000 : NaN);

  const byName = new Map<string, T[]>();
  for (const r of rows) {
    const k = nameKey(r.name);
    const list = byName.get(k);
    if (list) list.push(r);
    else byName.set(k, [r]);
  }

  const kept = new Set<T>();
  for (const group of byName.values()) {
    // cluster by near date; within a cluster keep the strongest record
    const sorted = [...group].sort((a, b) => (a.baptismDate ?? "").localeCompare(b.baptismDate ?? ""));
    let cluster: T[] = [];
    let anchor = NaN;
    const flush = () => {
      if (!cluster.length) return;
      cluster.sort(
        (a, b) =>
          weight(b) - weight(a) ||
          (a.baptismDate ?? "").localeCompare(b.baptismDate ?? ""),
      );
      kept.add(cluster[0]!);
      cluster = [];
    };
    for (const r of sorted) {
      const d = dayNum(r.baptismDate);
      if (cluster.length && !Number.isNaN(anchor) && !Number.isNaN(d) && d - anchor > DUP_WINDOW_DAYS) {
        flush();
      }
      if (!cluster.length) anchor = d;
      cluster.push(r);
    }
    flush();
  }
  return rows.filter((r) => kept.has(r));
}

/** Monday..Sunday (inclusive, so the weekend counts) of the week containing today (mission tz). */
export function calendarWeek(today: string = todayIso()): { start: string; end: string } {
  return calendarWeekOf(today);
}

/**
 * Summary cards for the Baptisms page.
 *
 * `weekStart == null` (the page's normal call) measures "this week" and "this
 * month" against **today's** calendar week (Mon through Sun, weekend included)
 * and today's calendar month — the STL sheet works in real time, not in IMOS
 * reporting weeks. Pass an explicit `weekStart` only for a historical view.
 * "Today" is the mission's local date, never UTC.
 */
export function summarise(
  friends: Friend[],
  weekStart: string | null,
  today: string = todayIso(),
): FriendsSummary {
  let wkStart: string, wkEnd: string, month: string;
  if (weekStart) {
    wkStart = weekStart;
    wkEnd = addDays(weekStart, 6);
    month = monthOf(weekStart);
  } else {
    const w = calendarWeek(today);
    wkStart = w.start;
    wkEnd = w.end;
    month = monthOf(today);
  }
  const horizon = weekStart ? wkStart : today;

  const onDate = friends.filter(isOnDate);
  const baptizedThisMonthAll = dedupeBaptized(
    friends.filter((f) => f.baptizedConfirmed && (f.baptismDate ?? "").startsWith(month)),
  );
  return {
    onDateTotal: onDate.length,
    onDateThisWeek: onDate.filter((f) => f.baptismDate! >= wkStart && f.baptismDate! <= wkEnd).length,
    overdueCount: onDate.filter((f) => f.baptismDate! < horizon).length,
    baptizedThisMonth: baptizedThisMonthAll.filter((f) => confirmedTier(f.confidence)).length,
    baptizedThisMonthUnverified: baptizedThisMonthAll.filter((f) => !confirmedTier(f.confidence)).length,
    calendarYes: onDate.filter((f) => f.onBaptismCalendar).length,
    calendarNo: onDate.filter((f) => !f.onBaptismCalendar).length,
    church2xYes: onDate.filter((f) => f.attendedChurch2x).length,
    church2xNo: onDate.filter((f) => !f.attendedChurch2x).length,
    weekStart: wkStart,
    weekEnd: wkEnd,
    month,
  };
}
