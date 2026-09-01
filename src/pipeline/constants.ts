/**
 * Fixed vocabulary for the pipeline.
 *
 * Anything the mission might want to change without touching code (the MLC
 * position set, the expected active-area band, the zone exclude list) is also
 * stored in the `config` table and merged over these defaults at runtime.
 *
 * Ported from ki-pipeline/pipeline/constants.py + rollup.py.
 */

export { KI_IDS, KI_CODE, KI_NAME, KI_ID_SET, KI_DECK_LABEL } from "../shared/ki.js";
export type { KiId } from "../shared/ki.js";

/**
 * An area counts as an "MLC area" if any missionary assigned to it holds one of
 * these positions. Drives the MLC share tables. District leaders are
 * deliberately excluded — MLC is APs, ZLs, STLs, STLTs.
 *
 * NOTE (see reconciliation §16): this set flags ~40 areas vs the old
 * hand-maintained list of ~27. Narrow it here or via config once the old
 * LeadershipAreas list is available.
 */
export const MLC_POSITIONS: ReadonlySet<string> = new Set([
  "ASSISTANT",
  "ZONE_LEADER",
  "ZONE_LEADER_LEAD",
  "SISTER_TRAINING_LEADER",
  "SISTER_TRAINING_LEADER_LEAD",
  "SISTER_TRAINING_LEADER_TRAINER",
]);

/**
 * The "Online" org appears under almost every area. Its actuals are counted in
 * the area total (so the numbers match Mission Portal) but it is never mapped
 * to a ward or stake.
 */
export const NON_WARD_ORG_IDS: ReadonlySet<number> = new Set([63939]);

/** Validation default: a normal week has this many active proselyting areas. */
export const EXPECTED_ACTIVE_AREA_BAND: readonly [number, number] = [95, 120];

/**
 * Zones summed away from both the zone list and the MISSION total. Non-
 * proselyting zones (S. Mission, Service) already drop out because none of
 * their areas are active; this is for a proselyting zone the mission has
 * chosen to keep off the decks.
 */
export const DEFAULT_ZONE_EXCLUDE: ReadonlySet<string> = new Set(["Bella Vista North"]);

/** Canonical zone order for the boards (Zone Names & Abbreviations.txt). */
export const ZONE_ORDER: readonly string[] = [
  "Alexandria",
  "Annandale",
  "Bull Run",
  "McLean",
  "Oakton",
  "Langley",
  "Loudoun",
  "Woodbridge",
  "Manassas",
  "Potomac",
];

export const ZONE_ABBR: Record<string, string> = {
  Alexandria: "AX",
  Annandale: "AN",
  "Bull Run": "BR",
  McLean: "MC",
  Oakton: "OK",
  Langley: "LA",
  Loudoun: "LD",
  Woodbridge: "WB",
  Manassas: "MS",
  Potomac: "PO",
};

export const MISSION_KEY = "MISSION";
export const UNMAPPED_STAKE = "(unmapped)";

/** Colour-band thresholds (also overridable via config). */
export const BANDS = {
  /** goal % : < low → red, < mid → amber, ≥ mid → green */
  goalPct: { low: 50, mid: 80 },
  /** MLC share % */
  mlcShare: { low: 20, mid: 30 },
} as const;
