/**
 * Calendar helpers pinned to the mission's time zone.
 *
 * Everything "today"-relative (this calendar week, this month, overdue
 * baptisms, the last complete reporting week) must be computed in Eastern
 * time, not UTC. Between 8 pm and midnight Eastern the UTC date is already
 * tomorrow, so a plain `new Date().toISOString()` flips the week on Sunday
 * evening while STLs are still finishing Sunday, marks today's baptisms
 * overdue, and rolls the month over four hours early.
 *
 * Shared by the Worker and the browser. Pure; no platform dependencies.
 */

export const MISSION_TZ = "America/New_York";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a well-formed YYYY-MM-DD that is also a real calendar date. */
export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !ISO_DATE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

/** The calendar date (YYYY-MM-DD) right now in `tz`. */
export function todayIso(tz: string = MISSION_TZ, now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD; Intl is available in Workers and every browser.
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Add whole days to a YYYY-MM-DD. */
export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** 0 = Monday … 6 = Sunday for a YYYY-MM-DD. */
export function dayOfWeekMonday0(iso: string): number {
  return (new Date(Date.parse(`${iso}T00:00:00Z`)).getUTCDay() + 6) % 7;
}

/** Monday of the Mon–Sun week containing `iso`. */
export function mondayOf(iso: string): string {
  return addDays(iso, -dayOfWeekMonday0(iso));
}

/** Monday..Sunday (inclusive) of the week containing `iso` (default: today in the mission tz). */
export function calendarWeekOf(iso: string = todayIso()): { start: string; end: string } {
  const start = mondayOf(iso);
  return { start, end: addDays(start, 6) };
}

/**
 * The most recent Mon–Sun reporting week that has fully passed as of `iso`.
 * On a Sunday the week in progress is not complete yet, so it returns the
 * previous one.
 */
export function lastCompleteWeekOf(iso: string = todayIso()): { monday: string; sunday: string } {
  const thisMonday = mondayOf(iso);
  const monday = addDays(thisMonday, -7);
  return { monday, sunday: addDays(monday, 6) };
}

/** YYYY-MM of `iso`. */
export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

/**
 * Subtract calendar months from a YYYY-MM-DD, clamping the day so
 * "Aug 31 minus 6 months" is Feb 28/29, not an overflow into March.
 */
export function addMonthsClamped(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map((x) => parseInt(x, 10)) as [number, number, number];
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), day)).toISOString().slice(0, 10);
}

/** The last `n` YYYY-MM keys ending with the month containing `iso`, oldest first. */
export function recentMonthKeys(n: number, iso: string = todayIso()): string[] {
  const [y, m] = iso.split("-").map((x) => parseInt(x, 10)) as [number, number];
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

/**
 * Every Monday between the first and last stored week that has no import.
 * Weeks are expected to be contiguous Mondays; a gap silently shrinks the
 * "last 4 weeks" window and any trend, so callers surface it.
 */
export function missingMondays(storedWeeks: readonly string[]): string[] {
  const weeks = [...storedWeeks].filter(isIsoDate).sort();
  if (weeks.length < 2) return [];
  const have = new Set(weeks);
  const out: string[] = [];
  for (let w = addDays(weeks[0]!, 7); w < weeks[weeks.length - 1]!; w = addDays(w, 7)) {
    if (!have.has(w)) out.push(w);
  }
  return out;
}
