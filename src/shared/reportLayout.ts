/**
 * The stake-president report layout, as a piece of configuration rather than
 * code. Which sections appear, in what order, and the handful of options each
 * one has, are stored in the `config` table under `stake_report_layout` and
 * edited at Admin → Stake reports. The renderer (src/web/publish/stakeReport.tsx)
 * reads this; the server (src/server/publish.ts) uses the windows.
 *
 * The point: when the mission president asks for "drop the trend, add a
 * sentence at the top, show only NP and BD", an office missionary does it in
 * the browser in two minutes. A genuinely new kind of section still needs
 * code, and that is documented as such.
 */

import { KI_IDS, type KiId } from "./ki.js";

export type SectionId = "intro" | "stats" | "wardTable" | "trend" | "onDate" | "baptized" | "note";

export interface LayoutSection {
  id: SectionId;
  enabled: boolean;
}

export interface StakeReportLayout {
  /** section order; a section missing here is treated as disabled */
  sections: LayoutSection[];
  /** which indicators the ward table and the trend show, in this order */
  kis: KiId[];
  /** weeks in the trend sparkbars (4–26) */
  trendWeeks: number;
  /** months back for the "baptized" list (1–24) */
  baptizedMonths: number;
  /** headline tiles */
  stats: { baptizedThisMonth: boolean; baptizedThisYear: boolean; onDate: boolean };
  /** columns in the on-date list */
  onDate: { church2x: boolean; calendar: boolean; ward: boolean };
  /** flag legacy unverified names in the baptized list */
  showUnverified: boolean;
  /** free text above the numbers (blank = nothing) */
  introText: string;
  /** free text below the lists, e.g. a standing note from the president (blank = nothing) */
  noteText: string;
  /** the small line under the stake name; {week} is replaced */
  subtitle: string;
}

export const SECTION_LABELS: Record<SectionId, string> = {
  intro: "Introductory paragraph",
  stats: "Headline tiles (baptized this month / this year / on a date)",
  wardTable: "This week by ward",
  trend: "Trend sparkbars",
  onDate: "Friends with a baptismal date",
  baptized: "Baptized recently",
  note: "Closing note",
};

export const DEFAULT_STAKE_REPORT_LAYOUT: StakeReportLayout = {
  sections: [
    { id: "intro", enabled: false },
    { id: "stats", enabled: true },
    { id: "wardTable", enabled: true },
    { id: "trend", enabled: true },
    { id: "onDate", enabled: true },
    { id: "baptized", enabled: true },
    { id: "note", enabled: false },
  ],
  kis: [...KI_IDS],
  trendWeeks: 12,
  baptizedMonths: 6,
  stats: { baptizedThisMonth: true, baptizedThisYear: true, onDate: true },
  onDate: { church2x: true, calendar: true, ward: true },
  showUnverified: true,
  introText: "",
  noteText: "",
  subtitle: "Key Indicators of Conversion · {week}",
};

const ALL_SECTIONS: SectionId[] = ["intro", "stats", "wardTable", "trend", "onDate", "baptized", "note"];

/**
 * Return a complete, valid layout from whatever is stored, or a reason it is
 * unusable. Unknown sections are dropped, missing ones appended disabled,
 * numbers clamped. Never throws.
 */
export function normalizeLayout(v: unknown): { layout: StakeReportLayout; problem: string | null } {
  const d = DEFAULT_STAKE_REPORT_LAYOUT;
  if (!v || typeof v !== "object") return { layout: d, problem: "layout must be an object" };
  const o = v as Partial<StakeReportLayout>;
  const seen = new Set<SectionId>();
  const sections: LayoutSection[] = [];
  for (const s of Array.isArray(o.sections) ? o.sections : []) {
    if (!s || typeof s !== "object") continue;
    const id = (s as LayoutSection).id;
    if (!ALL_SECTIONS.includes(id) || seen.has(id)) continue;
    seen.add(id);
    sections.push({ id, enabled: !!(s as LayoutSection).enabled });
  }
  for (const id of ALL_SECTIONS) if (!seen.has(id)) sections.push({ id, enabled: false });
  const kis = (Array.isArray(o.kis) ? o.kis : d.kis).filter((k): k is KiId => (KI_IDS as readonly number[]).includes(k));
  const clamp = (n: unknown, lo: number, hi: number, dflt: number) =>
    typeof n === "number" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt;
  const str = (s: unknown, dflt: string, max = 2000) => (typeof s === "string" ? s.slice(0, max) : dflt);
  const layout: StakeReportLayout = {
    sections,
    kis: kis.length ? kis : d.kis,
    trendWeeks: clamp(o.trendWeeks, 4, 26, d.trendWeeks),
    baptizedMonths: clamp(o.baptizedMonths, 1, 24, d.baptizedMonths),
    stats: {
      baptizedThisMonth: o.stats?.baptizedThisMonth ?? d.stats.baptizedThisMonth,
      baptizedThisYear: o.stats?.baptizedThisYear ?? d.stats.baptizedThisYear,
      onDate: o.stats?.onDate ?? d.stats.onDate,
    },
    onDate: {
      church2x: o.onDate?.church2x ?? d.onDate.church2x,
      calendar: o.onDate?.calendar ?? d.onDate.calendar,
      ward: o.onDate?.ward ?? d.onDate.ward,
    },
    showUnverified: o.showUnverified ?? d.showUnverified,
    introText: str(o.introText, d.introText),
    noteText: str(o.noteText, d.noteText),
    subtitle: str(o.subtitle, d.subtitle, 200) || d.subtitle,
  };
  const problem = kis.length === 0 ? "at least one indicator must be selected" : null;
  return { layout, problem };
}
