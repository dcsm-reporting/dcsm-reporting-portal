/**
 * Everything the Publish page needs in one call: the week's boards (mission +
 * per zone), and a per-stake report bundle (ward KI table, 12-week series,
 * on-date list, last-6-months baptisms, month + YTD baptism counts, recipients).
 *
 * The page renders these to PNGs (boards) and printable / emailable documents
 * (stake reports) client-side.
 */

import { dedupeBaptized, isOnDate, stakeForFriend } from "../pipeline/friends.js";
import { DEFAULT_EMAIL_TEMPLATE, type EmailTemplate } from "../shared/emailTemplate.js";
import { getAreaWardRows, weeksAvailable } from "./db.js";
import { listFriends, stakeLookup } from "./friends.js";
import { progressFor } from "./goals.js";
import { buildStakeView, buildWeekView, weekLabel } from "./service.js";
import { getStakeRecipients } from "./db.js";
import { getConfig } from "./db.js";
import { addMonthsClamped } from "../shared/dates.js";
import { DEFAULT_STAKE_REPORT_LAYOUT, normalizeLayout } from "../shared/reportLayout.js";

const confirmedTier = (c: string | null) => c === null || c === "confirmed";

export interface StakeReport {
  stake: string;
  presidentName: string | null;
  toEmails: string[];
  ccEmails: string[];
  wardTable: { ward: string; ki: Record<number, number> }[];
  total: Record<number, number>;
  series: { label: string; weekStart: string; BC: number; BD: number; SA: number; NP: number; LMP: number; NMS: number }[];
  onDate: {
    name: string;
    ward: string | null;
    baptismDate: string | null;
    attendedChurch2x: boolean;
    onBaptismCalendar: boolean;
    extra: Record<string, string>;
  }[];
  baptized6mo: { name: string; ward: string | null; baptismDate: string | null; confidence: string | null }[];
  baptizedThisMonth: number;
  baptizedYtd: number;
  /** the mission's baptism goal for the report month, when one is set */
  missionGoal: { month: string; goal: number; actual: number } | null;
}

export async function buildPublish(db: D1Database, week: string) {
  const { layout } = normalizeLayout(
    await getConfig<unknown>(db, "stake_report_layout", DEFAULT_STAKE_REPORT_LAYOUT),
  );
  const [weekView, stakeView, areaWard, friends, ccAll, emailTemplate] = await Promise.all([
    buildWeekView(db, week),
    buildStakeView(db, week, layout.trendWeeks),
    getAreaWardRows(db),
    listFriends(db, { includeInactive: true }),
    getConfig<string[]>(db, "report_cc_all", []),
    getConfig<EmailTemplate>(db, "report_email_template", DEFAULT_EMAIL_TEMPLATE),
  ]);
  const recipients = await getStakeRecipients(db);
  const recByStake = new Map(recipients.map((r) => [r.stake, r]));
  const prog = await progressFor(db, week);
  const missionGoal =
    prog.mission.month.goal !== null
      ? { month: prog.month, goal: prog.mission.month.goal, actual: prog.mission.month.actual }
      : null;

  const all = await weeksAvailable(db);
  const { stakeOfWard, knownStakes } = stakeLookup(areaWard, week);
  const stakeFor = (f: { stake: string | null; ward: string | null }) =>
    stakeForFriend(f, knownStakes, stakeOfWard);

  const month = week.slice(0, 7);
  const year = week.slice(0, 4);
  const cutoff = addMonthsClamped(week, -layout.baptizedMonths);

  // Active friends whose stake does not match any stake with a report — they
  // would otherwise silently appear on no report at all. Surfaced on the
  // Publish page so someone fixes the sheet's stake column.
  const reportStakes = new Set(stakeView.stakes);
  const unassigned = friends
    .filter((f) => f.active && (isOnDate(f) || (f.baptizedConfirmed && (f.baptismDate ?? "") >= cutoff)))
    .filter((f) => f.source !== "tableau")
    .filter((f) => !reportStakes.has(stakeFor(f)))
    .map((f) => ({
      name: f.name,
      ward: f.ward,
      stake: f.stake,
      zone: f.zone,
      baptismDate: f.baptismDate,
      baptizedConfirmed: f.baptizedConfirmed,
      source: f.source,
    }))
    .sort((a, b) => (b.baptismDate ?? "").localeCompare(a.baptismDate ?? ""));

  const reports: StakeReport[] = stakeView.stakes.map((stake) => {
    const g = stakeView.byStake[stake] ?? { wards: {}, total: {} };
    const rec = recByStake.get(stake);
    const mine = friends.filter((f) => f.active && stakeFor(f) === stake);
    const myBaptized = dedupeBaptized(mine.filter((f) => f.baptizedConfirmed));

    return {
      stake,
      presidentName: rec?.presidentName ?? null,
      toEmails: splitEmails(rec?.toEmails),
      // CC is one mission-wide list now (report_cc_all), not per stake
      ccEmails: [...new Set(ccAll)],
      wardTable: Object.entries(g.wards)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([ward, ki]) => ({ ward, ki: ki as Record<number, number> })),
      total: g.total as Record<number, number>,
      series: stakeView.stakeSeries[stake] ?? [],
      onDate: mine
        .filter(isOnDate)
        .sort((a, b) => (a.baptismDate ?? "").localeCompare(b.baptismDate ?? ""))
        .map((f) => ({
          name: f.name,
          ward: f.ward,
          baptismDate: f.baptismDate,
          attendedChurch2x: f.attendedChurch2x,
          onBaptismCalendar: f.onBaptismCalendar,
          extra: f.extra,
        })),
      baptized6mo: myBaptized
        .filter((f) => (f.baptismDate ?? "") >= cutoff)
        .sort((a, b) => (b.baptismDate ?? "").localeCompare(a.baptismDate ?? ""))
        .map((f) => ({ name: f.name, ward: f.ward, baptismDate: f.baptismDate, confidence: f.confidence })),
      baptizedThisMonth: myBaptized.filter(
        (f) => confirmedTier(f.confidence) && (f.baptismDate ?? "").startsWith(month),
      ).length,
      baptizedYtd: myBaptized.filter(
        (f) => confirmedTier(f.confidence) && (f.baptismDate ?? "").startsWith(year),
      ).length,
      missionGoal,
    };
  });

  return {
    week,
    weekLabel: weekLabel(week),
    generatedAt: new Date().toISOString(),
    hasPriorWeek: all.filter((w) => w < week).length > 0,
    emailTemplate: emailTemplate ?? DEFAULT_EMAIL_TEMPLATE,
    layout,
    /** sheet column headers seen on active friends that the portal has no named field for */
    extraKeys: [...new Set(friends.filter((f) => f.active).flatMap((f) => Object.keys(f.extra)))].sort(),
    board: {
      zones: weekView.zones,
      byZone: weekView.byZone,
      byArea: weekView.byArea,
      mlc: weekView.mlc,
      bands: weekView.bands,
      monthLabel: weekView.month.label,
      monthByZone: weekView.month.byZone,
    },
    reports,
    unassigned,
  };
}

function splitEmails(s: string | null | undefined): string[] {
  if (!s) return [];
  return s
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter((x) => x.includes("@") && !x.includes("#"));
}
