/**
 * Data carriers for the pipeline. Ported from the @dataclass definitions in
 * ki-pipeline/pipeline/read_imos.py, plus the raw IMOS payload shape.
 */

import type { KiId } from "../shared/ki.js";

// --- raw IMOS payload -------------------------------------------------------
// Only the fields the pipeline reads are typed; the payload carries more.

export interface ImosKiDatum {
  id: number;
  goal?: number | null;
  actual?: number | null;
  date?: string;
}

export interface ImosOrg {
  entityType: "org";
  id: number;
  name?: string | null;
  kiData?: ImosKiDatum[];
}

export interface ImosMissionary {
  missionaryId: number;
  firstName?: string | null;
  lastName?: string | null;
  areaId?: number;
  position?: string;
}

export interface ImosAreaHistory {
  modifiedBy?: string;
  modifiedByPosition?: string;
  modifiedDate?: string;
  week?: string;
}

export interface ImosArea {
  entityType: "area";
  id: number;
  name?: string | null;
  kiData?: ImosKiDatum[];
  entities?: ImosOrg[];
  missionaries?: ImosMissionary[];
  areaBookHistory?: { date?: string; enabled?: boolean }[];
  history?: ImosAreaHistory[];
}

export interface ImosDistrict {
  entityType: "district";
  id: number;
  name?: string | null;
  entities?: ImosArea[];
}

export interface ImosZone {
  entityType: "zone";
  id: number;
  name?: string | null;
  entities?: ImosDistrict[];
}

export interface ImosMissionEntity {
  entityType: "mission";
  id?: number;
  name?: string | null;
  entities?: ImosZone[];
}

export interface ImosPayload {
  entity?: ImosMissionEntity;
  keyIndicators?: { id: number; name?: string }[];
  reportStart?: string;
  reportEnd?: string;
  lastMissionKIOverride?: boolean;
  currentMissionKIOverride?: boolean;
}

// --- normalised rows -----------------------------------------------------

/** One area × indicator × week measurement. */
export interface KiFact {
  weekStart: string;
  zoneId: number;
  zoneName: string;
  districtId: number;
  districtName: string;
  areaId: number;
  areaName: string;
  kiId: KiId;
  goal: number | null;
  actual: number;
  isMlc: boolean;
}

/**
 * One org (ward) × indicator × week actual — for the stake reports.
 * Goals live only at area level in IMOS, so ward rows carry actual only.
 */
export interface WardFact {
  weekStart: string;
  imosAreaId: number;
  orgId: number;
  orgName: string;
  kiId: KiId;
  actual: number;
}

export interface MissionaryRow {
  weekStart: string;
  missionaryId: number;
  firstName: string;
  lastName: string;
  imosAreaId: number;
  position: string;
}

/** When each area's numbers were last touched in IMOS — feeds the Chase list. */
export interface AreaHistoryRow {
  weekStart: string;
  imosAreaId: number;
  imosAreaName: string;
  modifiedDate: string | null;
  /** True when history[] has an entry whose `week` == this reporting week. */
  updatedThisWeek: boolean;
}

export interface NormalizeResult {
  weekStart: string;
  weekEnd: string;
  facts: KiFact[];
  wardFacts: WardFact[];
  missionaries: MissionaryRow[];
  areaHistory: AreaHistoryRow[];
  activeAreaIds: Set<number>;
  warnings: string[];
}

// --- rollup output shapes ---------------------------------------------------

export interface KiCell {
  code: string;
  goal: number | null;
  actual: number;
  pct: number | null;
}

/** {zoneName | "MISSION": {kiId: KiCell}} */
export type ZoneGrid = Record<string, Record<number, KiCell>>;

export interface MlcCell {
  code: string;
  mission: number;
  mlc: number;
  share: number | null;
}
export type MlcGrid = Record<number, MlcCell>;

export interface StakeGroup {
  wards: Record<string, Record<number, number>>;
  total: Record<number, number>;
}
export type StakeGrid = Record<string, StakeGroup>;

export interface SeriesRow {
  label: string;
  weekStart: string;
  BC: number;
  BD: number;
  SA: number;
  NP: number;
  LMP: number;
  NMS: number;
}
