/**
 * Monthly baptism reconciliation.
 *
 * Per the SOP the authoritative baptism total is the count of NAMED completed
 * records (same ruling as the on-date figure). This view does not override that
 * — it surfaces two things a human should close before the monthly report goes
 * out:
 *
 *   1. the gap between that named count and the KI-feed / Mission-Portal
 *      aggregate (id 20), per stake — a flag, not a truth;
 *   2. "disappeared near their date" — on-date friends whose baptism date has
 *      passed and who left the sheet without ever being marked confirmed
 *      (the accidental-deletion / never-ticked case).
 */

import { byStake } from "../pipeline/rollup.js";
import { wardMapForWeek } from "../pipeline/resolve.js";
import { getAreaWardRows, loadWardFacts, weeksAvailable } from "./db.js";
import { listFriends } from "./friends.js";

const BC = 20; // "People Who Are Baptized and Confirmed"

export interface ReconcileRow {
  stake: string;
  kiFeedBC: number;
  namedCount: number; // confirmed-tier only (authoritative)
  unverifiedCount: number; // Zone-Leader-form-only legacy names, for context
  gap: number; // kiFeedBC - namedCount  (> 0 ⇒ names likely missing)
}
export interface DisappearedRow {
  id: string;
  name: string;
  ward: string | null;
  stake: string | null;
  baptismDate: string | null;
  leftAt: string;
  missionaries: string | null;
}
export interface ReconcileView {
  month: string;
  weeks: string[];
  mission: { kiFeedBC: number; namedCount: number; unverifiedCount: number; gap: number };
  byStake: ReconcileRow[];
  disappeared: DisappearedRow[];
}

const isConfirmedTier = (c: string | null) => c === null || c === "confirmed";

export async function buildReconcile(db: D1Database, month: string): Promise<ReconcileView> {
  const all = await weeksAvailable(db);
  const weeks = all.filter((w) => w.startsWith(month));
  const areaWard = await getAreaWardRows(db);

  // KI-feed B&C by stake, summed over the month's weeks
  const feedByStake = new Map<string, number>();
  let feedMission = 0;
  for (const w of weeks) {
    const wardMap = wardMapForWeek(areaWard, w);
    const grid = byStake(await loadWardFacts(db, w), wardMap);
    for (const [stake, g] of Object.entries(grid)) {
      const v = g.total[BC] ?? 0;
      feedByStake.set(stake, (feedByStake.get(stake) ?? 0) + v);
      feedMission += v;
    }
  }

  // named completed baptisms with baptism_date in the month
  const friends = await listFriends(db, { includeInactive: true });
  const refWeek = weeks[weeks.length - 1] ?? `${month}-15`;
  const stakeOfWard = new Map<string, string>();
  for (const [, [wn, s]] of wardMapForWeek(areaWard, refWeek)) stakeOfWard.set(wn.toLowerCase(), s);

  const namedByStake = new Map<string, number>();
  const unverifiedByStake = new Map<string, number>();
  let namedMission = 0;
  let unverifiedMission = 0;
  for (const f of friends) {
    if (!f.baptizedConfirmed || !(f.baptismDate ?? "").startsWith(month)) continue;
    const stake = f.stake || stakeOfWard.get((f.ward ?? "").toLowerCase()) || "(unassigned)";
    if (isConfirmedTier(f.confidence)) {
      namedByStake.set(stake, (namedByStake.get(stake) ?? 0) + 1);
      namedMission++;
    } else {
      unverifiedByStake.set(stake, (unverifiedByStake.get(stake) ?? 0) + 1);
      unverifiedMission++;
    }
  }

  const stakes = [
    ...new Set([...feedByStake.keys(), ...namedByStake.keys(), ...unverifiedByStake.keys()]),
  ].sort();
  const byStakeRows: ReconcileRow[] = stakes.map((stake) => {
    const kiFeedBC = feedByStake.get(stake) ?? 0;
    const namedCount = namedByStake.get(stake) ?? 0;
    const unverifiedCount = unverifiedByStake.get(stake) ?? 0;
    return { stake, kiFeedBC, namedCount, unverifiedCount, gap: kiFeedBC - namedCount };
  });

  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(Date.now() - 75 * 86_400_000).toISOString().slice(0, 10);
  const disappeared: DisappearedRow[] = friends
    .filter(
      (f) =>
        !f.active &&
        f.dropped &&
        !f.baptizedConfirmed &&
        f.baptismDate != null &&
        f.baptismDate <= today &&
        f.baptismDate >= horizon,
    )
    .map((f) => ({
      id: f.id,
      name: f.name,
      ward: f.ward,
      stake: f.stake,
      baptismDate: f.baptismDate,
      leftAt: f.updatedAt,
      missionaries: f.missionaries,
    }))
    .sort((a, b) => (b.baptismDate ?? "").localeCompare(a.baptismDate ?? ""));

  return {
    month,
    weeks,
    mission: {
      kiFeedBC: feedMission,
      namedCount: namedMission,
      unverifiedCount: unverifiedMission,
      gap: feedMission - namedMission,
    },
    byStake: byStakeRows,
    disappeared,
  };
}
