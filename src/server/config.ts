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
  /** An import warns when the active-area count falls outside [low, high]. */
  areaBand: { low: number; high: number };
}

export const CONFIG_DEFAULTS: ResolvedConfig = {
  mlcPositions: [...MLC_POSITIONS],
  zoneOrder: [...ZONE_ORDER],
  zoneExclude: [...DEFAULT_ZONE_EXCLUDE],
  bands: {
    goalPct: { low: BANDS.goalPct.low, mid: BANDS.goalPct.mid },
    mlcShare: { low: BANDS.mlcShare.low, mid: BANDS.mlcShare.mid },
  },
  areaBand: { low: 80, high: 130 },
};

export const CONFIG_KEYS = ["mlc_positions", "zone_order", "zone_exclude", "bands", "area_band"] as const;

/** Reject a config write that would break the pipeline (wrong shape / type). */
export function validateConfigValue(key: (typeof CONFIG_KEYS)[number], value: unknown): string | null {
  const isStrList = (v: unknown) => Array.isArray(v) && v.every((s) => typeof s === "string");
  const isInt = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0;
  switch (key) {
    case "mlc_positions":
    case "zone_order":
    case "zone_exclude":
      return isStrList(value) ? null : `${key} must be a list of strings`;
    case "bands": {
      const b = value as ResolvedConfig["bands"] | null;
      if (
        !b ||
        !isInt(b.goalPct?.low) ||
        !isInt(b.goalPct?.mid) ||
        !isInt(b.mlcShare?.low) ||
        !isInt(b.mlcShare?.mid)
      )
        return "bands must carry goalPct.{low,mid} and mlcShare.{low,mid} as whole numbers";
      if (b.goalPct.low > b.goalPct.mid || b.mlcShare.low > b.mlcShare.mid)
        return "the amber threshold must not exceed the green one";
      return null;
    }
    case "area_band": {
      const a = value as ResolvedConfig["areaBand"] | null;
      if (!a || !isInt(a.low) || !isInt(a.high) || a.low > a.high)
        return "area_band must be {low, high} whole numbers with low ≤ high";
      return null;
    }
  }
}

export async function loadConfig(db: D1Database): Promise<ResolvedConfig> {
  const [mlcPositions, zoneOrder, zoneExclude, bands, areaBand] = await Promise.all([
    getConfig(db, "mlc_positions", CONFIG_DEFAULTS.mlcPositions),
    getConfig(db, "zone_order", CONFIG_DEFAULTS.zoneOrder),
    getConfig(db, "zone_exclude", CONFIG_DEFAULTS.zoneExclude),
    getConfig(db, "bands", CONFIG_DEFAULTS.bands),
    getConfig(db, "area_band", CONFIG_DEFAULTS.areaBand),
  ]);
  // A stored value that has drifted from the expected shape must not take the
  // whole portal down; fall back to the default for that one key.
  return {
    mlcPositions: validateConfigValue("mlc_positions", mlcPositions) ? CONFIG_DEFAULTS.mlcPositions : mlcPositions,
    zoneOrder: validateConfigValue("zone_order", zoneOrder) ? CONFIG_DEFAULTS.zoneOrder : zoneOrder,
    zoneExclude: validateConfigValue("zone_exclude", zoneExclude) ? CONFIG_DEFAULTS.zoneExclude : zoneExclude,
    bands: validateConfigValue("bands", bands) ? CONFIG_DEFAULTS.bands : bands,
    areaBand: validateConfigValue("area_band", areaBand) ? CONFIG_DEFAULTS.areaBand : areaBand,
  };
}
