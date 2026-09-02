/**
 * Everything the Publish page needs in one call: the week's boards (mission +
 * per zone), and a per-stake report bundle (ward KI table, 12-week series,
 * on-date list, last-6-months baptisms, month + YTD baptism counts, recipients).
 *
 * The page renders these to PNGs (boards) and printable / emailable documents
 * (stake reports) client-side.
 */

import { isOnDate } from "../pipeline/friends.js";
import { getAreaWardRows, weeksAvailable } from "./db.js";
import { wardMapForWeek } from "../pipeline/resolve.js";
import { listFriends } from "./friends.js";
import { buildStakeView, buildWeekView, weekLabel } from "./service.js";
import { getStakeRecipients } from "./db.js";
import { getConfig } from "./db.js";

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
  }[];
  baptized6mo: { name: string; ward: string | null; baptismDate: string | null; confidence: string | null }[];
  baptizedThisMonth: number;
  baptizedYtd: number;
}

export async function buildPublish(db: D1Database, week: string) {
  const [weekView, stakeView, areaWard, friends, ccAll] = await Promise.all([
    buildWeekView(db, week),
    buildStakeView(db, week),
    getAreaWardRows(db),
    listFriends(db, { includeInactive: true }),
    getConfig<string[]>(db, "report_cc_all", []),
  ]);
  const recipients = await getStakeRecipients(db);
  const recByStake = new Map(recipients.map((r) => [r.stake, r]));

  const all = await weeksAvailable(db);
  const wardMap = wardMapForWeek(areaWard, week);
  const stakeOfWard = new Map<string, string>();
  for (const [, [wn, s]] of wardMap) stakeOfWard.set(wn.toLowerCase(), s);
  const stakeFor = (f: { stake: string | null; ward: string | null }) =>
    f.stake || stakeOfWard.get((f.ward ?? "").toLowerCase()) || "(unassigned)";

  const month = week.slice(0, 7);
  const year = week.slice(0, 4);
  const sixMonthsAgo = new Date(Date.parse(`${week}T00:00:00Z`));
  sixMonthsAgo.setUTCMonth(sixMonthsAgo.getUTCMonth() - 6);
  const cutoff = sixMonthsAgo.toISOString().slice(0, 10);

  const reports: StakeReport[] = stakeView.stakes.map((stake) => {
    const g = stakeView.byStake[stake] ?? { wards: {}, total: {} };
    const rec = recByStake.get(stake);
    const mine = friends.filter((f) => f.active && stakeFor(f) === stake);

    return {
      stake,
      presidentName: rec?.presidentName ?? null,
      toEmails: splitEmails(rec?.toEmails),
      ccEmails: [...new Set([...splitEmails(rec?.ccEmails), ...ccAll])],
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
        })),
      baptized6mo: friends
        .filter((f) => f.baptizedConfirmed && (f.baptismDate ?? "") >= cutoff && stakeFor(f) === stake)
        .sort((a, b) => (b.baptismDate ?? "").localeCompare(a.baptismDate ?? ""))
        .map((f) => ({ name: f.name, ward: f.ward, baptismDate: f.baptismDate, confidence: f.confidence })),
      baptizedThisMonth: friends.filter(
        (f) =>
          f.baptizedConfirmed &&
          confirmedTier(f.confidence) &&
          (f.baptismDate ?? "").startsWith(month) &&
          stakeFor(f) === stake,
      ).length,
      baptizedYtd: friends.filter(
        (f) =>
          f.baptizedConfirmed &&
          confirmedTier(f.confidence) &&
          (f.baptismDate ?? "").startsWith(year) &&
          stakeFor(f) === stake,
      ).length,
    };
  });

  return {
    week,
    weekLabel: weekLabel(week),
    generatedAt: new Date().toISOString(),
    hasPriorWeek: all.filter((w) => w < week).length > 0,
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
  };
}

function splitEmails(s: string | null | undefined): string[] {
  if (!s) return [];
  return s
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter((x) => x.includes("@") && !x.includes("#"));
}
