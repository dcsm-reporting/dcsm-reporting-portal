/**
 * Friends / on-date helpers — pure. Shared by the server and the legacy import.
 */

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
  dropped: boolean;
  source: "sheet" | "portal";
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
  baptizedThisMonth: number;
  calendarYes: number;
  calendarNo: number;
  church2xYes: number;
  church2xNo: number;
}

export function summarise(
  friends: Friend[],
  weekStart: string | null,
): FriendsSummary {
  const wkEnd =
    weekStart == null
      ? null
      : new Date(Date.parse(`${weekStart}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
  const month = weekStart?.slice(0, 7) ?? new Date().toISOString().slice(0, 7);

  const onDate = friends.filter(isOnDate);
  return {
    onDateTotal: onDate.length,
    onDateThisWeek:
      weekStart == null
        ? 0
        : onDate.filter((f) => f.baptismDate! >= weekStart && f.baptismDate! <= wkEnd!).length,
    baptizedThisMonth: friends.filter(
      (f) => f.baptizedConfirmed && (f.baptismDate ?? "").startsWith(month),
    ).length,
    calendarYes: onDate.filter((f) => f.onBaptismCalendar).length,
    calendarNo: onDate.filter((f) => !f.onBaptismCalendar).length,
    church2xYes: onDate.filter((f) => f.attendedChurch2x).length,
    church2xNo: onDate.filter((f) => !f.attendedChurch2x).length,
  };
}
