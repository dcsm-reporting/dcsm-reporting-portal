/**
 * Load, validate, and normalise the IMOS Key Indicators report.
 *
 * The payload is the JSON returned by:
 *   GET https://imos.churchofjesuschrist.org/ws/auth-controller/api-v1/ki/report/{start}/{end}
 *
 * Shape:
 *   entity                        entityType = "mission"
 *     └─ entities[]               entityType = "zone"      -> id, name
 *         └─ entities[]           entityType = "district"  -> id, name
 *             └─ entities[]       entityType = "area"      -> id, name
 *                 ├─ kiData[]        { id, goal?, date }        <- AREA GOAL
 *                 ├─ entities[]      entityType = "org"          <- WARD(S)
 *                 │    └─ kiData[]   { id, actual?, date }       <- ACTUAL
 *                 ├─ missionaries[] { missionaryId, firstName, lastName, position }
 *                 ├─ areaBookHistory[] { date, enabled }
 *                 └─ history[]      { modifiedDate, week }
 *
 * Rules:
 *   goal   = area.kiData[] entry for the ki id; may be absent -> null (not 0)
 *   actual = sum of org.kiData[].actual across ALL orgs of the area for the ki id
 *   keep only areas whose latest areaBookHistory.enabled is true
 *
 * Ported verbatim from ki-pipeline/pipeline/read_imos.py.
 */

import {
  EXPECTED_ACTIVE_AREA_BAND,
  KI_ID_SET,
  KI_IDS,
  MLC_POSITIONS,
  NON_WARD_ORG_IDS,
  type KiId,
} from "./constants.js";
import type {
  AreaHistoryRow,
  ImosArea,
  ImosPayload,
  KiFact,
  MissionaryRow,
  NormalizeResult,
  WardFact,
} from "./types.js";

export class ValidationError extends Error {
  override name = "ValidationError";
}

// --- loading -------------------------------------------------------------
/** Parse a payload from a raw JSON string (throws SyntaxError on bad JSON). */
export function load(source: string): ImosPayload {
  return JSON.parse(source) as ImosPayload;
}

// --- tree walking ---------------------------------------------------------
export interface AreaCtx {
  zoneId: number;
  zoneName: string;
  districtId: number;
  districtName: string;
  area: ImosArea;
}

/** Yield every area in the tree with its zone/district context. */
export function* iterAreas(payload: ImosPayload): Generator<AreaCtx> {
  const mission = payload.entity;
  if (!mission) return;
  for (const zone of mission.entities ?? []) {
    if (zone.entityType !== "zone") continue;
    for (const district of zone.entities ?? []) {
      if (district.entityType !== "district") continue;
      for (const area of district.entities ?? []) {
        if (area.entityType !== "area") continue;
        yield {
          zoneId: zone.id,
          zoneName: zone.name ?? "",
          districtId: district.id,
          districtName: district.name ?? "",
          area,
        };
      }
    }
  }
}

/** True when the area's most recent areaBookHistory entry is enabled. */
export function areaActive(area: ImosArea): boolean {
  const history = area.areaBookHistory ?? [];
  if (history.length === 0) return false;
  return Boolean(history[history.length - 1]!.enabled);
}

function areaGoal(area: ImosArea, kiId: number): number | null {
  for (const entry of area.kiData ?? []) {
    if (entry.id === kiId) {
      return entry.goal ?? null; // key absent -> null
    }
  }
  return null;
}

function areaActual(area: ImosArea, kiId: number): number {
  let total = 0;
  for (const org of area.entities ?? []) {
    if (org.entityType !== "org") continue;
    for (const entry of org.kiData ?? []) {
      if (entry.id === kiId) total += entry.actual ?? 0;
    }
  }
  return total;
}

function areaIsMlc(area: ImosArea): boolean {
  return (area.missionaries ?? []).some(
    (m) => m.position !== undefined && MLC_POSITIONS.has(m.position),
  );
}

/** Latest history[].modifiedDate for the Chase list; null when never touched. */
function areaLastModified(area: ImosArea): string | null {
  let latest: string | null = null;
  for (const h of area.history ?? []) {
    const d = h.modifiedDate ?? null;
    if (d && (latest === null || d > latest)) latest = d;
  }
  return latest;
}

/** True when history[] has an entry tagged with this reporting week. */
function areaUpdatedThisWeek(area: ImosArea, weekStart: string): boolean {
  return (area.history ?? []).some((h) => h.week === weekStart);
}

// --- validation --------------------------------------------------------
/**
 * Check the payload. Throw ValidationError on a hard defect; return warnings.
 *
 * Hard defects: not a mission payload, keyIndicators id set wrong, no areas.
 * Warnings: week mismatch, active-area count outside the band, an area with no
 * kiData, a negative or non-integer measurement.
 */
export function validate(
  payload: ImosPayload,
  opts: {
    expectedWeek?: readonly [string, string] | null;
    areaBand?: readonly [number, number];
  } = {},
): string[] {
  const areaBand = opts.areaBand ?? EXPECTED_ACTIVE_AREA_BAND;
  const warnings: string[] = [];

  const entity = payload.entity;
  if (!entity || typeof entity !== "object" || entity.entityType !== "mission") {
    throw new ValidationError(
      `top-level entity is not a mission payload (got entityType=${
        entity && typeof entity === "object" ? String(entity.entityType) : typeof entity
      })`,
    );
  }

  const kiDefs = payload.keyIndicators ?? [];
  const gotIds = new Set(kiDefs.map((k) => k.id));
  const sameIds =
    gotIds.size === KI_ID_SET.size && [...KI_ID_SET].every((id) => gotIds.has(id));
  if (!sameIds) {
    throw new ValidationError(
      `keyIndicators id set changed: expected ${[...KI_ID_SET]
        .slice()
        .sort((a, b) => a - b)
        .join(",")}, got ${[...gotIds]
        .filter((i) => i != null)
        .sort((a, b) => a - b)
        .join(",")}`,
    );
  }

  const areas = [...iterAreas(payload)];
  if (areas.length === 0) throw new ValidationError("payload contains no areas");

  if (opts.expectedWeek != null) {
    const got: [string | undefined, string | undefined] = [
      payload.reportStart,
      payload.reportEnd,
    ];
    if (got[0] !== opts.expectedWeek[0] || got[1] !== opts.expectedWeek[1]) {
      warnings.push(
        `payload week ${JSON.stringify(got)} does not match requested week ${JSON.stringify(
          opts.expectedWeek,
        )}`,
      );
    }
  }

  const active = areas.filter((ctx) => areaActive(ctx.area));
  const [lo, hi] = areaBand;
  if (!(lo <= active.length && active.length <= hi)) {
    warnings.push(
      `active area count ${active.length} is outside the expected band ${JSON.stringify(areaBand)}`,
    );
  }

  for (const ctx of active) {
    const area = ctx.area;
    if (!area.kiData || area.kiData.length === 0) {
      warnings.push(`active area ${JSON.stringify(area.name)} (${area.id}) has no kiData`);
    }
    for (const kiId of KI_IDS) {
      const g = areaGoal(area, kiId);
      if (g !== null && (!Number.isInteger(g) || g < 0)) {
        warnings.push(
          `${JSON.stringify(area.name)} ki ${kiId}: goal is not a non-negative int (${JSON.stringify(g)})`,
        );
      }
      const a = areaActual(area, kiId);
      if (a < 0) {
        warnings.push(`${JSON.stringify(area.name)} ki ${kiId}: actual sums negative (${a})`);
      }
    }
  }

  return warnings;
}

// --- normalisation ----------------------------------------------------------
/** Validate, then flatten active areas to KiFact / WardFact / MissionaryRow lists. */
export function normalize(
  payload: ImosPayload,
  opts: {
    expectedWeek?: readonly [string, string] | null;
    areaBand?: readonly [number, number];
  } = {},
): NormalizeResult {
  const warnings = validate(payload, opts);

  const weekStart = payload.reportStart ?? "";
  const weekEnd = payload.reportEnd ?? "";
  const result: NormalizeResult = {
    weekStart,
    weekEnd,
    facts: [],
    wardFacts: [],
    missionaries: [],
    areaHistory: [],
    activeAreaIds: new Set<number>(),
    warnings,
  };

  for (const ctx of iterAreas(payload)) {
    const area = ctx.area;
    if (!areaActive(area)) continue;
    const areaId = area.id;
    result.activeAreaIds.add(areaId);
    const isMlc = areaIsMlc(area);

    for (const kiId of KI_IDS) {
      result.facts.push({
        weekStart,
        zoneId: ctx.zoneId,
        zoneName: ctx.zoneName,
        districtId: ctx.districtId,
        districtName: ctx.districtName,
        areaId,
        areaName: area.name ?? "",
        kiId,
        goal: areaGoal(area, kiId),
        actual: areaActual(area, kiId),
        isMlc,
      } satisfies KiFact);
    }

    for (const org of area.entities ?? []) {
      if (org.entityType !== "org" || NON_WARD_ORG_IDS.has(org.id)) continue;
      const byKi = new Map<number, number>();
      for (const e of org.kiData ?? []) byKi.set(e.id, e.actual ?? 0);
      for (const kiId of KI_IDS) {
        result.wardFacts.push({
          weekStart,
          imosAreaId: areaId,
          orgId: org.id,
          orgName: (org.name ?? "").trim(),
          kiId,
          actual: byKi.get(kiId) ?? 0,
        } satisfies WardFact);
      }
    }

    for (const m of area.missionaries ?? []) {
      result.missionaries.push({
        weekStart,
        missionaryId: m.missionaryId,
        firstName: (m.firstName ?? "").trim(),
        lastName: (m.lastName ?? "").trim(),
        imosAreaId: areaId,
        position: m.position ?? "",
      } satisfies MissionaryRow);
    }

    result.areaHistory.push({
      weekStart,
      imosAreaId: areaId,
      imosAreaName: area.name ?? "",
      modifiedDate: areaLastModified(area),
      updatedThisWeek: areaUpdatedThisWeek(area, weekStart),
    } satisfies AreaHistoryRow);
  }

  return result;
}

export { areaGoal, areaActual, areaIsMlc, areaLastModified, areaUpdatedThisWeek };
export type { KiId };
