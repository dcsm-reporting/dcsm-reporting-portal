/**
 * Reading Tableau's own downloads (docs/legacy-ki-export.md), without any
 * preparation step: the crosstab CSV of the "Missionaries Key Indicators"
 * table and of the "People Baptized and Confirmed" list. Pure functions, used
 * by the loader on Admin → Data and covered by test/tableau.test.ts.
 */

/** Comma- or tab-separated (Tableau's crosstab download is tab-separated), quoted fields, CRLF. Cells trimmed. */
export function parseTable(text: string): string[][] {
  const nl = text.indexOf("\n");
  const firstLine = text.slice(0, nl < 0 ? text.length : nl);
  const delim = (firstLine.match(/\t/g) ?? []).length > (firstLine.match(/,/g) ?? []).length ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim());
      cell = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

const MONTHS_EN = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const pad2 = (n: number) => String(n).padStart(2, "0");
const validYmd = (y: number, m: number, d: number) =>
  m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2100 ? `${y}-${pad2(m)}-${pad2(d)}` : null;

/**
 * A date as Tableau or Excel might write it: 2026-08-30, 30/08/2026 (day first
 * unless told otherwise, falling back to the other order when the first is
 * impossible), 24 August 2025, August 24, 2025, or an Excel serial number.
 */
export function toIsoDate(raw: string, dayFirst = true): string | null {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return validYmd(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (m) {
    const y = m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!;
    const [p1, p2] = [+m[1]!, +m[2]!];
    return dayFirst ? (validYmd(y, p2, p1) ?? validYmd(y, p1, p2)) : (validYmd(y, p1, p2) ?? validYmd(y, p2, p1));
  }
  m = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(s);
  if (m) {
    const mi = MONTHS_EN.indexOf(m[2]!.toLowerCase());
    return mi >= 0 ? validYmd(+m[3]!, mi + 1, +m[1]!) : null;
  }
  m = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (m) {
    const mi = MONTHS_EN.indexOf(m[1]!.toLowerCase());
    return mi >= 0 ? validYmd(+m[3]!, mi + 1, +m[2]!) : null;
  }
  if (/^\d{5}$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + +s * 86_400_000);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

export const isSunday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay() === 0;

const KI_HEADERS: [RegExp, string][] = [
  [/^new people goal$/i, "np_goal"], [/^new people actual$/i, "np_actual"],
  [/^lessons with member participat\w* goal$/i, "lmp_goal"], [/^lessons with member participat\w* actual$/i, "lmp_actual"],
  [/^potential member sacrament goal$/i, "sa_goal"], [/^potential member sacrament actual$/i, "sa_actual"],
  [/^has baptismal date goal$/i, "bd_goal"], [/^has baptismal date actual$/i, "bd_actual"],
  [/^baptized and confirmed goal$/i, "bc_goal"], [/^baptized and confirmed actual$/i, "bc_actual"],
  [/^new members at sacrament goal$/i, "nms_goal"], [/^new members at sacrament actual$/i, "nms_actual"],
];

function objects(header: string[], body: string[][]): Record<string, string>[] {
  return body.map((r) => Object.fromEntries(header.map((k, j) => [k, r[j] ?? ""])));
}

/**
 * Rows for POST /api/import/legacy from either shape:
 *  - Tableau's "Missionaries Key Indicators" download as it comes: a first
 *    column carrying the date only on the first row of each week, then
 *    "id, date", the date, zone, district, area, missionaries, and the twelve
 *    indicator columns named in the header row;
 *  - the prepared CSV (header starts with week_end).
 */
export function normalizeAreaRows(rows: string[][]): Record<string, string>[] {
  const prepared = rows.findIndex((r) => r.some((c) => /^week_end$/i.test(c)));
  if (prepared >= 0) return objects(rows[prepared]!.map((c) => c.toLowerCase()), rows.slice(prepared + 1));
  const h = rows.findIndex((r) => r.some((c) => KI_HEADERS[0]![0].test(c)));
  if (h < 0) throw new Error('not an indicator file: no "New People Goal" column and no week_end column');
  const kiCol: Record<string, number> = {};
  rows[h]!.forEach((c, i) => {
    for (const [re, key] of KI_HEADERS) if (re.test(c)) kiCol[key] = i;
  });
  const found = Object.keys(kiCol).length;
  if (found !== 12) throw new Error(`indicator columns found: ${found} of 12`);
  const out: Record<string, string>[] = [];
  let badDates = 0;
  for (const r of rows.slice(h + 1)) {
    const idCol = r.findIndex((c) => /^\d{3,}\s*,\s*\S/.test(c));
    if (idCol < 0) continue;
    const [id, dateRaw] = r[idCol]!.split(/\s*,\s*/);
    let weekEnd = toIsoDate(dateRaw ?? "", true);
    if (!weekEnd || !isSunday(weekEnd)) {
      const alt = toIsoDate(dateRaw ?? "", false);
      if (alt && isSunday(alt)) weekEnd = alt;
    }
    if (!weekEnd || !isSunday(weekEnd)) {
      badDates++;
      continue;
    }
    const o: Record<string, string> = {
      week_end: weekEnd,
      area_id: id!,
      zone: r[idCol + 2] ?? "",
      district: r[idCol + 3] ?? "",
      area: r[idCol + 4] ?? "",
    };
    for (const [k, i] of Object.entries(kiCol)) o[k] = r[i] ?? "";
    out.push(o);
  }
  if (badDates) throw new Error(`${badDates} row(s) had a date that is not a Sunday; check the download`);
  return out;
}

/** Tableau decorates some names with icons; the record wants the name. */
export const stripIcons = (s: string) =>
  s.replace(/[\p{Extended_Pictographic}️‍]/gu, "").replace(/\s+/g, " ").trim();

/**
 * Rows for POST /api/friends/legacy from either shape:
 *  - Tableau's "People Baptized and Confirmed" download as it comes (no
 *    header: id, name, zone, district, area, date);
 *  - the prepared CSV (header starts with external_id).
 */
export function normalizeBaptismRows(rows: string[][]): Record<string, string>[] {
  const prepared = rows.findIndex((r) => r.some((c) => /^external_id$/i.test(c)));
  if (prepared >= 0) return objects(rows[prepared]!.map((c) => c.toLowerCase()), rows.slice(prepared + 1));
  const out: Record<string, string>[] = [];
  for (const r of rows) {
    if (r.length < 5 || !/^\d{4,}$/.test(r[0] ?? "")) continue;
    out.push({
      external_id: r[0]!,
      name: stripIcons(r[1] ?? ""),
      zone: r[2] ?? "",
      district: r[3] ?? "",
      area: r[4] ?? "",
      baptism_date: toIsoDate(r[5] ?? "", true) ?? "",
    });
  }
  if (!out.length) throw new Error("not a baptism file: expected rows of id, name, zone, district, area, date");
  return out;
}
