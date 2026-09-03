/**
 * Numbers for the Monday MLC Google Slides decks (weekly and monthly).
 *
 * `apps_script/slides-refresh.gs` fetches this instead of reading the retired
 * reporting sheets. The shape mirrors what the script's old sheet gatherers
 * produced, so its drawing code did not change:
 *
 *   zones[].kis[DECK_CODE] = { goal, actual }     deck codes: BC BD SAC NP LWM RCA
 *   mission                = the same, summed over the listed zones
 *   mlc.thisWeek[CODE]     = { goal: mission total, actual: MLC areas }
 *
 * Zone order and exclusions come from Reporting settings, so the deck follows
 * the portal. Numbers only: no names, nothing personal. Rosters stay on the
 * Baptisms (MLC) sheet, which the script reads directly.
 */

import { byZone, mlc, monthByZone } from "../pipeline/rollup.js";
import { MISSION_KEY } from "../pipeline/constants.js";
import type { KiCell, KiFact, MlcGrid } from "../pipeline/types.js";
import { KI_DECK_LABEL, KI_IDS } from "../shared/ki.js";
import { lastCompleteWeekOf, missingMondays, todayIso } from "../shared/dates.js";
import { loadConfig } from "./config.js";
import { loadFacts, mlcAreaIdsForWeek, weeksAvailable } from "./db.js";
import { orderedZones, periodLabel, recentWeeks, weekLabel, withMlc } from "./service.js";

export type SlidesMode = "weekly" | "monthly";

/** {deckCode: {goal, actual}}. A goal the data never had reads as 0, as the sheets did. */
export type DeckKis = Record<string, { goal: number; actual: number }>;

export interface SlidesZone {
  name: string;
  kis: DeckKis;
  /** monthly only: the window's weeks, oldest first */
  detail: { week: string; label: string; kis: DeckKis }[] | null;
}

export interface SlidesData {
  mode: SlidesMode;
  /** the week the numbers describe (Monday, ISO) */
  week: string;
  subtitle: string;
  zones: SlidesZone[];
  mission: DeckKis;
  mlc: {
    thisWeek: DeckKis;
    thisWeekLabel: string;
    lastWeek: DeckKis | null;
    lastWeekLabel: string | null;
  };
  /** weeks summed (weekly: one; monthly: up to four, oldest first) */
  window: string[];
  /** plain-language cautions for the script's log */
  notes: string[];
  generatedAt: string;
}

export function deckKis(grid: Record<number, KiCell> | undefined): DeckKis {
  const out: DeckKis = {};
  for (const ki of KI_IDS) {
    const c = grid?.[ki];
    out[KI_DECK_LABEL[ki]] = { goal: c?.goal ?? 0, actual: c?.actual ?? 0 };
  }
  return out;
}

export function deckMlc(grid: MlcGrid): DeckKis {
  const out: DeckKis = {};
  for (const ki of KI_IDS) {
    const c = grid[ki];
    out[KI_DECK_LABEL[ki]] = { goal: c?.mission ?? 0, actual: c?.mlc ?? 0 };
  }
  return out;
}

/**
 * @param week  Monday to build for; defaults to the latest imported week.
 */
export async function buildSlides(
  db: D1Database,
  mode: SlidesMode,
  week?: string,
  today: string = todayIso(),
): Promise<SlidesData> {
  const cfg = await loadConfig(db);
  const exclude = new Set(cfg.zoneExclude);
  const all = await weeksAvailable(db);
  if (!all.length) throw new Error("no weeks imported yet");
  const target = week ?? all[all.length - 1]!;
  if (!all.includes(target)) throw new Error(`week ${target} is not imported`);

  const notes: string[] = [];
  const expected = lastCompleteWeekOf(today).monday;
  if (!week && target < expected) {
    notes.push(
      `WARNING: the latest imported week is ${weekLabel(target)}; the last complete week is ` +
        `${weekLabel(expected)}. Import it in the portal before publishing.`,
    );
  }

  const load = async (w: string): Promise<KiFact[]> =>
    withMlc(await loadFacts(db, w), await mlcAreaIdsForWeek(db, w, cfg.mlcPositions));

  const facts = await load(target);
  const prior = all.filter((w) => w < target);
  const lastStart = prior[prior.length - 1] ?? null;
  const lastFacts = lastStart ? await load(lastStart) : null;
  const mlcBlock: SlidesData["mlc"] = {
    thisWeek: deckMlc(mlc(facts, exclude)),
    thisWeekLabel: weekLabel(target),
    lastWeek: lastFacts ? deckMlc(mlc(lastFacts, exclude)) : null,
    lastWeekLabel: lastStart ? weekLabel(lastStart) : null,
  };
  if (!lastStart) notes.push("NOTE: no earlier week is imported; the MLC slide's LAST WEEK block is blank.");
  const generatedAt = new Date().toISOString();

  if (mode === "weekly") {
    const grid = byZone(facts, exclude);
    const zones = orderedZones(Object.keys(grid), cfg.zoneOrder);
    return {
      mode,
      week: target,
      subtitle: weekLabel(target),
      zones: zones.map((z) => ({ name: z, kis: deckKis(grid[z]), detail: null })),
      mission: deckKis(grid[MISSION_KEY]),
      mlc: mlcBlock,
      window: [target],
      notes,
      generatedAt,
    };
  }

  // monthly: the four most recent imported weeks up to the target, oldest first
  const window = recentWeeks(all, target, 4);
  const weekFacts: KiFact[][] = [];
  for (const w of window) weekFacts.push(w === target ? facts : await load(w));
  const perWeek = window.map((w, i) => ({ week: w, grid: byZone(weekFacts[i]!, exclude) }));
  const gaps = missingMondays([window[0]!, target]).filter((w) => !window.includes(w));
  if (gaps.length) {
    notes.push(
      `WARNING: the 4-week window skips ${gaps.map(weekLabel).join(", ")} (never imported), ` +
        `so the month totals span more than four calendar weeks.`,
    );
  }
  if (window.length < 4) notes.push(`NOTE: only ${window.length} week(s) imported; the month totals cover those.`);

  const mgrid = monthByZone(weekFacts, exclude);
  const zones = orderedZones(Object.keys(mgrid), cfg.zoneOrder);
  return {
    mode,
    week: target,
    subtitle: periodLabel(window),
    zones: zones.map((z) => ({
      name: z,
      kis: deckKis(mgrid[z]),
      detail: perWeek.map((p) => ({ week: p.week, label: weekLabel(p.week), kis: deckKis(p.grid[z]) })),
    })),
    mission: deckKis(mgrid[MISSION_KEY]),
    mlc: mlcBlock,
    window,
    notes,
    generatedAt,
  };
}
