/**
 * Runtime configuration — read from the `config` table on every request, with
 * the code constants as the fallback. Editing these in the Admin → Config page
 * changes behaviour immediately, no deploy. This is what keeps transfers and
 * policy tweaks out of the codebase.
 */

import {
  BANDS,
  DEFAULT_ZONE_EXCLUDE,
  MLC_POSITIONS,
  ZONE_ORDER,
} from "../pipeline/constants.js";
import { getConfig } from "./db.js";

export interface ResolvedConfig {
  mlcPositions: string[];
  zoneOrder: string[];
  zoneExclude: string[];
  bands: {
    goalPct: { low: number; mid: number };
    mlcShare: { low: number; mid: number };
  };
}

export const CONFIG_DEFAULTS: ResolvedConfig = {
  mlcPositions: [...MLC_POSITIONS],
  zoneOrder: [...ZONE_ORDER],
  zoneExclude: [...DEFAULT_ZONE_EXCLUDE],
  bands: {
    goalPct: { low: BANDS.goalPct.low, mid: BANDS.goalPct.mid },
    mlcShare: { low: BANDS.mlcShare.low, mid: BANDS.mlcShare.mid },
  },
};

export const CONFIG_KEYS = ["mlc_positions", "zone_order", "zone_exclude", "bands"] as const;

export async function loadConfig(db: D1Database): Promise<ResolvedConfig> {
  const [mlcPositions, zoneOrder, zoneExclude, bands] = await Promise.all([
    getConfig(db, "mlc_positions", CONFIG_DEFAULTS.mlcPositions),
    getConfig(db, "zone_order", CONFIG_DEFAULTS.zoneOrder),
    getConfig(db, "zone_exclude", CONFIG_DEFAULTS.zoneExclude),
    getConfig(db, "bands", CONFIG_DEFAULTS.bands),
  ]);
  return { mlcPositions, zoneOrder, zoneExclude, bands };
}
