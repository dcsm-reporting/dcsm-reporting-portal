/**
 * Assemble the views the UI consumes from stored facts + the crosswalk.
 * Ports ki-pipeline/pipeline/service.py (build_grids / trend) — same window
 * rules, same labels — and threads the runtime config (zone order/exclude,
 * MLC positions, colour bands) so those are live knobs, not code constants.
 */

import {
  byArea,
  byStake,
  byZone,
  mlc,
  monthByZone,
  series,
  stakeSeries,
  type WeekFacts,
  type WeekWardFacts,
} from "../pipeline/rollup.js";
import { resolveWeek, wardMapForWeek } from "../pipeline/resolve.js";
import { MISSION_KEY } from "../pipeline/constants.js";
import { planRollover, type RolloverInput, type RolloverPlan } from "../pipeline/rollover.js";
import type { AreaKey } from "../pipeline/crosswalkSeed.js";
import type { KiFact } from "../pipeline/types.js";
import { loadConfig, type ResolvedConfig } from "./config.js";
import {
  addWard,
  attachArea,
  audit,
  createCanonicalArea,
  distinctZonesForWeek,
  getAreaWardRows,
  getCanonicalRows,
  getCrosswalkRows,
  loadAreaHistory,
  loadFacts,
  loadWardFacts,
  mlcAreaIdsForWeek,
  weeksAvailable,
} from "./db.js";

export function weekLabel(weekStart: string): string {
  const [, m, d] = weekStart.split("-").map((x) => parseInt(x, 10));
  return `Week of ${m}/${d}`;
}

export function periodLabel(weekStarts: string[]): string {
  const months = new Map<string, number>();
  for (const w of weekStarts) {
    const [y, m] = w.split("-");
    months.set(`${y}-${m}`, (months.get(`${y}-${m}`) ?? 0) + 1);
  }
  let best = "";
  let bestN = -1;
  for (const [k, n] of months) if (n > bestN) ((best = k), (bestN = n));
  const [y, m] = best.split("-").map((x) => parseInt(x, 10));
  const name = new Date(Date.UTC(y!, m! - 1, 1)).toLocaleString("en-US", {
    month: "long",
    timeZone: "UTC",
  });
  return `${name} ${y}`;
}

function recentWeeks(all: string[], upTo: string, n: number): string[] {
  return all.filter((w) => w <= upTo).slice(-n);
}

export function orderedZones(names: Iterable<string>, zoneOrder: string[]): string[] {
  const present = new Set(names);
  const known = zoneOrder.filter((z) => present.has(z));
  const extra = [...present]
    .filter((n) => !zoneOrder.includes(n) && n !== MISSION_KEY)
    .sort();
  return [...known, ...extra];
}

/** Override each fact's is_mlc from the week's missionary snapshot + config. */
function withMlc(facts: KiFact[], mlcIds: Set<number>): KiFact[] {
  return facts.map((f) => (f.isMlc === mlcIds.has(f.areaId) ? f : { ...f, isMlc: mlcIds.has(f.areaId) }));
}

export async function buildWeekView(db: D1Database, weekStart: string) {
  const cfg = await loadConfig(db);
  const exclude = new Set(cfg.zoneExclude);

  let facts = await loadFacts(db, weekStart);
  if (facts.length === 0) throw new Error(`no facts stored for week ${weekStart}`);
  facts = withMlc(facts, await mlcAreaIdsForWeek(db, weekStart, cfg.mlcPositions));

  const all = await weeksAvailable(db);
  const window = recentWeeks(all, weekStart, 4);
  const monthWeekFacts: KiFact[][] = [];
  for (const w of window) {
    if (w === weekStart) monthWeekFacts.push(facts);
    else {
      const wf = withMlc(await loadFacts(db, w), await mlcAreaIdsForWeek(db, w, cfg.mlcPositions));
      monthWeekFacts.push(wf);
    }
  }

  const priorWeeks = all.filter((w) => w < weekStart);
  const lastWeekStart = priorWeeks[priorWeeks.length - 1] ?? null;
  const lastFacts = lastWeekStart
    ? withMlc(await loadFacts(db, lastWeekStart), await mlcAreaIdsForWeek(db, lastWeekStart, cfg.mlcPositions))
    : null;

  const [crosswalk, canonical, areaWard] = await Promise.all([
    getCrosswalkRows(db),
    getCanonicalRows(db),
    getAreaWardRows(db),
  ]);
  const rr = resolveWeek(facts, weekStart, { crosswalk, areaWard, canonical });

  const zGrid = byZone(facts, exclude);
  const zones = orderedZones(Object.keys(zGrid), cfg.zoneOrder);

  return {
    weekStart,
    weekLabel: weekLabel(weekStart),
    generatedAt: new Date().toISOString(),
    zones,
    bands: cfg.bands,
    byZone: zGrid,
    byArea: Object.fromEntries(zones.map((z) => [z, byArea(facts, z)])),
    mlc: {
      this: mlc(facts, exclude),
      last: lastFacts ? mlc(lastFacts, exclude) : null,
      lastWeekStart,
    },
    month: {
      byZone: monthByZone(monthWeekFacts, exclude),
      window,
      label: periodLabel(window),
    },
    resolve: {
      resolvedCount: rr.resolved.size,
      unmapped: rr.unmapped.map(([id, name]) => ({ imosAreaId: id, imosAreaName: name })),
    },
  };
}

export async function buildTrends(
  db: D1Database,
  opts: { upTo?: string; n?: number; zone?: string | null; mlcOnly?: boolean } = {},
) {
  const cfg = await loadConfig(db);
  const exclude = new Set(cfg.zoneExclude);
  const all = await weeksAvailable(db);
  const upTo = opts.upTo ?? all[all.length - 1] ?? "";
  const weeks = recentWeeks(all, upTo, opts.n ?? 12);
  const wf: WeekFacts[] = [];
  for (const w of weeks) {
    let f = await loadFacts(db, w);
    if (opts.mlcOnly) f = withMlc(f, await mlcAreaIdsForWeek(db, w, cfg.mlcPositions));
    wf.push({ label: weekLabel(w), weekStart: w, facts: f });
  }
  return series(wf, { zone: opts.zone ?? null, mlcOnly: opts.mlcOnly ?? false, exclude });
}

export async function buildStakeView(db: D1Database, weekStart: string, windowN = 12) {
  const all = await weeksAvailable(db);
  const areaWard = await getAreaWardRows(db);
  const wardMap = wardMapForWeek(areaWard, weekStart);

  const grid = byStake(await loadWardFacts(db, weekStart), wardMap);
  const weeks = recentWeeks(all, weekStart, windowN);
  const wf: WeekWardFacts[] = [];
  for (const w of weeks)
    wf.push({ label: weekLabel(w), weekStart: w, wardFacts: await loadWardFacts(db, w) });

  const stakes = Object.keys(grid).sort();
  return {
    weekStart,
    weekLabel: weekLabel(weekStart),
    wardMapSize: wardMap.size,
    stakes,
    byStake: grid,
    stakeSeries: Object.fromEntries(stakes.map((s) => [s, stakeSeries(wf, wardMap, s)])),
  };
}

export async function buildChase(db: D1Database, weekStart: string) {
  const [history, facts] = await Promise.all([
    loadAreaHistory(db, weekStart),
    loadFacts(db, weekStart),
  ]);
  const zoneOf = new Map<number, string>();
  for (const f of facts) if (!zoneOf.has(f.areaId)) zoneOf.set(f.areaId, f.zoneName);

  const stale = history
    .filter((h) => !h.updatedThisWeek)
    .map((h) => ({
      imosAreaId: h.imosAreaId,
      areaName: h.imosAreaName,
      zoneName: zoneOf.get(h.imosAreaId) ?? "",
      lastModified: h.modifiedDate,
    }))
    .sort((a, b) => a.zoneName.localeCompare(b.zoneName) || a.areaName.localeCompare(b.areaName));

  return { weekStart, weekLabel: weekLabel(weekStart), count: stale.length, areas: stale };
}

// --- transfer rollover ------------------------------------------------
export async function buildRollover(
  db: D1Database,
  weekStart: string,
  areaKey: AreaKey,
): Promise<RolloverPlan> {
  const [facts, wardFacts, crosswalk, areaWard, canonical, all] = await Promise.all([
    loadFacts(db, weekStart),
    loadWardFacts(db, weekStart),
    getCrosswalkRows(db),
    getAreaWardRows(db),
    getCanonicalRows(db),
    weeksAvailable(db),
  ]);
  if (facts.length === 0) throw new Error(`no facts stored for week ${weekStart}`);

  const areas = new Map<number, RolloverInput["areas"][number]>();
  for (const f of facts)
    if (!areas.has(f.areaId))
      areas.set(f.areaId, { imosAreaId: f.areaId, imosAreaName: f.areaName, zoneName: f.zoneName });
  const areaName = new Map([...areas.values()].map((a) => [a.imosAreaId, a.imosAreaName]));
  const orgs = new Map<number, RolloverInput["orgs"][number]>();
  for (const w of wardFacts)
    if (!orgs.has(w.orgId))
      orgs.set(w.orgId, {
        orgId: w.orgId,
        orgName: w.orgName,
        imosAreaId: w.imosAreaId,
        areaName: areaName.get(w.imosAreaId) ?? "",
      });

  const prior = all.filter((w) => w < weekStart);
  const prevZoneNames = prior.length
    ? await distinctZonesForWeek(db, prior[prior.length - 1]!)
    : null;

  return planRollover({
    weekStart,
    areas: [...areas.values()],
    orgs: [...orgs.values()],
    prevZoneNames,
    crosswalk,
    areaWard,
    canonical,
    areaKey,
  });
}

export interface RolloverApply {
  validFrom: string;
  areas: { imosAreaId: number; canonicalAreaKey: string; isNew: boolean; displayName: string }[];
  wards: { orgId: number; canonicalAreaKey: string; wardName: string; stake: string }[];
}

export async function applyRollover(
  db: D1Database,
  actor: string,
  body: RolloverApply,
): Promise<{ areas: number; wards: number }> {
  const vf = body.validFrom;
  for (const a of body.areas) {
    if (a.isNew) await createCanonicalArea(db, a.canonicalAreaKey, a.displayName || a.canonicalAreaKey, vf);
    await attachArea(db, a.imosAreaId, a.canonicalAreaKey, vf, "rollover");
  }
  for (const w of body.wards) {
    await addWard(db, w.canonicalAreaKey, w.orgId, w.wardName, w.stake, vf);
  }
  await audit(db, actor, "rollover.apply", {
    validFrom: vf,
    areas: body.areas.length,
    wards: body.wards.length,
  });
  return { areas: body.areas.length, wards: body.wards.length };
}

// --- weekly console (dashboard) ------------------------------------
export async function buildConsole(db: D1Database, areaKey: AreaKey) {
  const cfg: ResolvedConfig = await loadConfig(db);
  const all = await weeksAvailable(db);
  if (all.length === 0) {
    return {
      weeksStored: 0,
      range: null,
      latest: null,
      steps: [
        { id: "import", label: "Import the first IMOS week", state: "todo", detail: "No weeks stored yet." },
      ],
      config: cfg,
    };
  }
  const latest = all[all.length - 1]!;
  const [week, chase, stake, rollover] = await Promise.all([
    buildWeekView(db, latest),
    buildChase(db, latest),
    buildStakeView(db, latest),
    buildRollover(db, latest, areaKey),
  ]);

  const steps = [
    {
      id: "import",
      label: `Import — ${week.weekLabel}`,
      state: "done" as const,
      detail: `${week.zones.length} zones, ${week.resolve.resolvedCount} areas resolved.`,
    },
    {
      id: "crosswalk",
      label: "Crosswalk clean",
      state: week.resolve.unmapped.length === 0 ? ("done" as const) : ("attention" as const),
      detail:
        week.resolve.unmapped.length === 0
          ? "Every area resolves."
          : `${week.resolve.unmapped.length} area(s) unmapped — run Rollover.`,
    },
    {
      id: "rollover",
      label: "Structure up to date",
      state: rollover.summary.clean ? ("done" as const) : ("attention" as const),
      detail: rollover.summary.clean
        ? "No structural changes to resolve."
        : `${rollover.summary.areasUnmapped} area(s), ${rollover.summary.wardsUnmapped} ward(s), ` +
          `${rollover.summary.zonesNew} new / ${rollover.summary.zonesRetired} retired zone(s).`,
    },
    {
      id: "chase",
      label: "Chase list",
      state: chase.count === 0 ? ("done" as const) : ("attention" as const),
      detail:
        chase.count === 0
          ? "Every active area updated this week."
          : `${chase.count} area(s) haven't touched their numbers.`,
    },
    {
      id: "boards",
      label: "Download board images",
      state: "todo" as const,
      detail: "This Week → Publish (PNG export — coming).",
    },
    {
      id: "stakes",
      label: "Draft stake reports",
      state: stake.wardMapSize > 0 ? ("todo" as const) : ("attention" as const),
      detail:
        stake.wardMapSize > 0
          ? `${stake.stakes.length} stakes ready.`
          : "No ward→stake rows for this week — seed the crosswalk.",
    },
  ];

  return {
    weeksStored: all.length,
    range: { first: all[0]!, last: latest },
    latest,
    latestLabel: week.weekLabel,
    counts: {
      zones: week.zones.length,
      areasResolved: week.resolve.resolvedCount,
      areasUnmapped: week.resolve.unmapped.length,
      stakes: stake.stakes.length,
      chase: chase.count,
    },
    steps,
    config: cfg,
  };
}
