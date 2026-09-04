import type {
  MlcGrid,
  SeriesRow,
  StakeGrid,
  ZoneGrid,
} from "@pipeline/types";
import type { EmailTemplate } from "@shared/emailTemplate";
import type { StakeReportLayout } from "@shared/reportLayout";

export type { EmailTemplate, StakeReportLayout };

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${r.status} ${url}`);
  }
  return r.json() as Promise<T>;
}
async function jsend<T>(method: string, url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await r.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
  if (!r.ok) throw Object.assign(new Error(data.error ?? `${r.status}`), { data });
  return data as T;
}
const jpost = <T>(url: string, body: unknown) => jsend<T>("POST", url, body);
const jput = <T>(url: string, body: unknown) => jsend<T>("PUT", url, body);

export interface WeekMeta {
  weekStart: string;
  weekLabel: string;
}
export interface WeeksResponse {
  weeks: WeekMeta[];
  latest: string | null;
  /** Monday of the most recent complete Mon–Sun week (mission time zone). */
  expectedLatest?: string;
  /** Mondays between the first and last stored week with no import. */
  missing?: string[];
  /** Every zone present in stored data, in configured order, minus excluded ones. */
  zones?: string[];
}

export interface WeekView {
  weekStart: string;
  weekLabel: string;
  generatedAt: string;
  zones: string[];
  bands: { goalPct: { low: number; mid: number }; mlcShare: { low: number; mid: number } };
  byZone: ZoneGrid;
  byArea: Record<string, ZoneGrid>;
  mlc: { this: MlcGrid; last: MlcGrid | null; lastWeekStart: string | null };
  month: { byZone: ZoneGrid; mlc: MlcGrid; window: string[]; label: string; gaps?: string[] };
  resolve: { resolvedCount: number; unmapped: { imosAreaId: number; imosAreaName: string }[] };
}

export interface ImportSummary {
  weekStart: string;
  weekEnd: string;
  weekLabel: string;
  activeAreas: number;
  nFacts: number;
  nWardFacts: number;
  nMissionaries: number;
  warnings: string[];
  notes?: string[];
  inactiveWithData?: { areaId: number; areaName: string; zoneName: string; actuals: Record<number, number> }[];
  alreadyStored: boolean;
  /** false when the payload range is not one Mon–Sun week */
  weekly?: boolean;
  unmapped: { imosAreaId: number; imosAreaName: string }[];
  structure?: {
    vsPrev: StructureDiff | null;
    transfer: boolean;
    vsStored: StructureDiff | null;
    storedDrift: boolean;
  };
}
export interface StructureDiff {
  week: string;
  zonesNew: string[];
  zonesGone: string[];
  areasNew: { imosAreaId: number; name: string; zone: string }[];
  areasGone: { imosAreaId: number; name: string; zone: string }[];
  movedZone: { imosAreaId: number; name: string; from: string; to: string }[];
  renamed: { imosAreaId: number; from: string; to: string }[];
  wardsNew: { orgId: number; name: string }[];
  wardsGone: { orgId: number; name: string }[];
}

export interface StakeView {
  weekStart: string;
  weekLabel: string;
  wardMapSize: number;
  stakes: string[];
  byStake: StakeGrid;
  stakeSeries: Record<string, SeriesRow[]>;
}

export interface NotReportedArea {
  imosAreaId: number;
  areaName: string;
  zoneName: string;
  lastModified: string | null;
  newThisWeek: boolean;
  ackReason?: string | null;
  ackedBy?: string | null;
}
export interface ChaseView {
  weekStart: string;
  weekLabel: string;
  count: number;
  newCount: number;
  ackCount: number;
  open: NotReportedArea[];
  newThisTransfer: NotReportedArea[];
  acknowledged: NotReportedArea[];
  areas: NotReportedArea[];
}

export interface GoalProgressCell {
  goal: number | null;
  actual: number;
  derived: boolean;
}
export interface GoalProgress {
  month: string;
  year: string;
  mission: { month: GoalProgressCell; year: GoalProgressCell };
  zones: Record<string, { month: GoalProgressCell; year: GoalProgressCell }>;
  any: boolean;
}
export interface BaptismsByZone {
  months: string[];
  zones: { zone: string; counts: Record<string, number>; total: number; share: number }[];
  mission: { counts: Record<string, number>; total: number };
}
export interface GoalsView {
  year: string;
  months: string[];
  zones: string[];
  rows: { period: string; zone: string; goal: number }[];
  actuals: Record<string, Record<string, number>>;
}

export const api = {
  me: () => jget<{ user: string; isAdmin: boolean; authorized?: boolean }>("/api/me"),
  admins: () => jget<{ admins: string[]; viewers: string[] }>("/api/admins"),
  setAdmins: (admins: string[]) =>
    jpost<{ ok: true; admins: string[]; viewers: string[] }>("/api/admins", { admins }),
  setViewers: (viewers: string[]) =>
    jpost<{ ok: true; admins: string[]; viewers: string[] }>("/api/admins", { viewers }),
  weeks: () => jget<WeeksResponse>("/api/weeks"),
  week: (w: string) => jget<WeekView>(`/api/week/${w}`),
  trends: (q: { upTo?: string; n?: number; zone?: string | null; mlcOnly?: boolean }) => {
    const p = new URLSearchParams();
    if (q.upTo) p.set("upTo", q.upTo);
    if (q.n) p.set("n", String(q.n));
    if (q.zone) p.set("zone", q.zone);
    if (q.mlcOnly) p.set("mlcOnly", "1");
    return jget<{ rows: SeriesRow[]; goals: SeriesRow[] }>(`/api/trends?${p}`);
  },
  monthlyBaptisms: (n = 6) =>
    jget<{ months: { month: string; confirmed: number; unverified: number; goal?: number | null }[] }>(
      `/api/friends/monthly?n=${n}`,
    ),
  legacyWeek: (weekEnd: string, rows: Record<string, unknown>[]) =>
    jpost<{ weekStart: string; weekEnd: string; areas: number; facts: number; reused: boolean; skipped?: "imos" }>(
      "/api/import/legacy",
      { weekEnd, rows },
    ),
  legacyBaptisms: (rows: Record<string, unknown>[]) =>
    jpost<{ rows: number; already: number; matchedCurrent: number; confirmedLegacy: number; inserted: number; skipped: number }>(
      "/api/friends/legacy",
      { rows },
    ),
  baptismsByZone: (n = 6) => jget<BaptismsByZone>(`/api/friends/by-zone?n=${n}`),
  goals: (year: string) => jget<GoalsView>(`/api/goals?year=${year}`),
  setGoals: (entries: { period: string; zone: string; goal: number | null }[]) =>
    jput<{ ok: true; written: number; removed: number }>("/api/goals", { entries }),
  stakes: (w: string) => jget<StakeView>(`/api/stakes/${w}`),
  chase: (w: string) => jget<ChaseView>(`/api/chase/${w}`),
  ackNotReported: (w: string, imosAreaId: number, reason: string) =>
    jpost<{ ok: true }>(`/api/chase/${w}/ack`, { imosAreaId, reason }),
  unackNotReported: (w: string, imosAreaId: number) =>
    jsend<{ ok: true }>("DELETE", `/api/chase/${w}/ack/${imosAreaId}`, undefined),
  importPreview: (rawJson: string) =>
    jpost<{ dryRun: true; summary: ImportSummary }>("/api/import", { rawJson, dryRun: true }),
  importCommit: (rawJson: string, force = false) =>
    jpost<{ dryRun: false; summary: ImportSummary; stored: { staleRemoved?: number; reused?: boolean } }>(
      "/api/import",
      { rawJson, dryRun: false, force },
    ),
  crosswalk: () =>
    jget<{ canonical: unknown[]; crosswalk: unknown[]; areaWard: unknown[] }>("/api/crosswalk"),

  // --- weekly console -----------------------------------------------
  console: () => jget<ConsoleView>("/api/console"),
  checkStep: (stepId: string, checked: boolean) =>
    jpost<{ ok: true }>("/api/console/check", { stepId, checked }),

  // --- config ------------------------------------------------------
  config: () => jget<ConfigResponse>("/api/config"),
  setConfig: (key: string, value: unknown) =>
    jput<{ ok: true; config: PortalConfig }>("/api/config", { key, value }),

  // --- structure -------------------------------------------------
  structure: () => jget<Structure>("/api/structure"),

  // --- transfer rollover -------------------------------------
  rollover: (w: string) => jget<RolloverPlan>(`/api/rollover/${w}`),
  applyRollover: (w: string, body: RolloverApplyBody) =>
    jpost<{
      ok: true;
      applied: { areas: number; wards: number; closed: number; retired: number; skipped: string[] };
      plan: RolloverPlan;
    }>(`/api/rollover/${w}/apply`, body),

  // --- crosswalk edits ---------------------------------------
  renameCanonical: (key: string, displayName: string) =>
    jpost<{ ok: true }>("/api/crosswalk/canonical/rename", { key, displayName }),
  retireCanonical: (key: string, retired: boolean) =>
    jpost<{ ok: true }>("/api/crosswalk/canonical/retire", { key, retired }),
  createCanonical: (key: string, displayName: string) =>
    jpost<{ ok: true }>("/api/crosswalk/canonical", { key, displayName }),
  attachArea: (imosAreaId: number, canonicalAreaKey: string, validFrom: string) =>
    jpost<{ ok: true }>("/api/crosswalk/attach", { imosAreaId, canonicalAreaKey, validFrom }),
  closeMapping: (imosAreaId: number, validFrom: string, validTo: string) =>
    jpost<{ ok: true }>("/api/crosswalk/mapping/close", { imosAreaId, validFrom, validTo }),
  addWard: (b: {
    canonicalAreaKey: string;
    wardUnitId: number;
    wardName: string;
    stake: string;
    validFrom: string;
  }) => jpost<{ ok: true }>("/api/crosswalk/ward", b),
  closeWard: (canonicalAreaKey: string, wardUnitId: number, validFrom: string, validTo: string) =>
    jpost<{ ok: true }>("/api/crosswalk/ward/close", {
      canonicalAreaKey,
      wardUnitId,
      validFrom,
      validTo,
    }),
  renameStake: (from: string, to: string) =>
    jpost<{ ok: true; changed: number }>("/api/stake/rename", { from, to }),
  moveWards: (wardUnitIds: number[], stake: string, validFrom: string) =>
    jpost<{ ok: true; changed: number; unknown: number[] }>("/api/ward/move", { wardUnitIds, stake, validFrom }),
  renameWard: (wardUnitId: number, wardName: string) =>
    jpost<{ ok: true; changed: number }>("/api/ward/rename", { wardUnitId, wardName }),
  retireWard: (wardUnitId: number, validTo: string, mergedInto?: number | null) =>
    jpost<{ ok: true; changed: number }>("/api/ward/retire", { wardUnitId, validTo, mergedInto: mergedInto ?? null }),
  seed: (weekStart: string, validFrom?: string) =>
    jpost<{ ok: true; validFrom: string; counts: Record<string, number>; unresolved: string[] }>(
      "/api/seed",
      { weekStart, validFrom },
    ),

  // --- friends / on-date (read-only; source is the Baptisms sheet) --------
  friends: (q: { zone?: string; stake?: string; status?: "on-date" | "baptized" | "all" } = {}) => {
    const p = new URLSearchParams();
    if (q.zone) p.set("zone", q.zone);
    if (q.stake) p.set("stake", q.stake);
    if (q.status) p.set("status", q.status);
    return jget<{ friends: FriendRow[] }>(`/api/friends?${p}`);
  },
  friendsSummary: (week?: string) =>
    jget<FriendsSummary>(`/api/friends/summary${week ? `?week=${week}` : ""}`),
  friendsByStake: (week: string) =>
    jget<Record<string, { onDate: FriendRow[]; baptized: FriendRow[] }>>(
      `/api/friends/by-stake/${week}`,
    ),
  reconcile: (month?: string) =>
    jget<ReconcileView>(`/api/reconcile${month ? `?month=${month}` : ""}`),
  recordBaptism: (b: {
    name: string;
    baptismDate: string;
    ward?: string;
    stake?: string;
    zone?: string;
    missionaries?: string;
    notes?: string;
  }) => jpost<{ ok: true; id: string; duplicate: boolean }>("/api/friends/record", b),
  deleteRecord: (id: string) =>
    jsend<{ ok: true }>("DELETE", `/api/friends/record/${id}`, undefined),
  correctBaptism: (id: string, reason: string) =>
    jpost<{ ok: true; name: string }>(`/api/friends/${id}/correct`, { reason }),
  data: () => jget<DataView>("/api/data"),
  exportUrl: "/api/export",

  // --- publish ---------------------------------------------------
  publish: (week: string) => jget<PublishView>(`/api/publish/${week}`),
  recipients: () =>
    jget<{
      recipients: StakeRecipient[];
      ccAll: string[];
      emailTemplate: EmailTemplate;
      defaultEmailTemplate: EmailTemplate;
    }>("/api/recipients"),
  setRecipient: (r: { stake: string; presidentName: string | null; toEmails: string | null }) =>
    jpost<{ ok: true }>("/api/recipients", r),
  setReportCc: (ccAll: string[]) =>
    jpost<{ ok: true; ccAll: string[] }>("/api/recipients/cc", { ccAll }),
  setReportTemplate: (t: EmailTemplate) =>
    jpost<{ ok: true; emailTemplate: EmailTemplate }>("/api/recipients/template", t),
  seedRecipients: () => jpost<{ ok: true; seeded: number }>("/api/recipients/seed", {}),
};

export interface StakeRecipient {
  stake: string;
  presidentName: string | null;
  toEmails: string | null;
}

export interface StakeReport {
  stake: string;
  presidentName: string | null;
  toEmails: string[];
  ccEmails: string[];
  wardTable: { ward: string; ki: Record<number, number> }[];
  total: Record<number, number>;
  series: {
    label: string;
    weekStart: string;
    BC: number;
    BD: number;
    SA: number;
    NP: number;
    LMP: number;
    NMS: number;
  }[];
  onDate: {
    name: string;
    ward: string | null;
    baptismDate: string | null;
    attendedChurch2x: boolean;
    onBaptismCalendar: boolean;
    extra?: Record<string, string>;
  }[];
  baptized6mo: { name: string; ward: string | null; baptismDate: string | null; confidence: string | null }[];
  baptizedThisMonth: number;
  baptizedYtd: number;
  missionGoal?: { month: string; goal: number; actual: number } | null;
}

export interface PublishView {
  week: string;
  weekLabel: string;
  generatedAt: string;
  hasPriorWeek: boolean;
  board: {
    zones: string[];
    byZone: ZoneGrid;
    byArea: Record<string, ZoneGrid>;
    mlc: { this: MlcGrid; last: MlcGrid | null; lastWeekStart: string | null };
    bands: { goalPct: { low: number; mid: number }; mlcShare: { low: number; mid: number } };
    monthLabel: string;
    monthByZone: ZoneGrid;
  };
  reports: StakeReport[];
  emailTemplate: EmailTemplate;
  layout?: StakeReportLayout;
  /** sheet columns the portal has no named field for (available as on-date columns) */
  extraKeys?: string[];
  /** active on-date / recently baptized friends whose stake matches no report */
  unassigned?: {
    name: string;
    ward: string | null;
    stake: string | null;
    zone: string | null;
    baptismDate: string | null;
    baptizedConfirmed: boolean;
    source: string;
  }[];
}

export interface DataView {
  imports: {
    weekStart: string;
    weekEnd: string;
    importedAt: string;
    importedBy: string | null;
    sha: string;
    nFacts: number;
  }[];
  audit: { at: string; actor: string; action: string; detail: string | null }[];
  syncs: {
    at: string;
    rowsIn: number;
    upserted: number;
    deactivated: number;
    warnings: string | null;
  }[];
}

export interface ReconcileView {
  month: string;
  weeks: string[];
  mission: { kiFeedBC: number; namedCount: number; unverifiedCount: number; gap: number };
  byStake: { stake: string; kiFeedBC: number; namedCount: number; unverifiedCount: number; gap: number }[];
  disappeared: {
    id: string;
    name: string;
    ward: string | null;
    stake: string | null;
    baptismDate: string | null;
    leftAt: string;
    missionaries: string | null;
  }[];
}

export interface FriendRow {
  id: string;
  name: string;
  zone: string | null;
  ward: string | null;
  stake: string | null;
  missionaries: string | null;
  baptismDate: string | null;
  baptismTime: string | null;
  baptismAddress: string | null;
  attendedChurch2x: boolean;
  onBaptismCalendar: boolean;
  baptizedConfirmed: boolean;
  confirmedAt: string | null;
  confidence: string | null;
  notes: string | null;
  dropped: boolean;
  source: string;
  leftSheetAt: string | null;
  /** set while an on-date friend is missing from the sheet and the grace period runs */
  missingSince?: string | null;
  /** any sheet column the portal has no named field for, {header: value} */
  extra?: Record<string, string>;
}
export interface FriendsSummary {
  goals?: GoalProgress | null;
  onDateTotal: number;
  onDateThisWeek: number;
  overdueCount: number;
  baptizedThisMonth: number;
  baptizedThisMonthUnverified: number;
  calendarYes: number;
  calendarNo: number;
  church2xYes: number;
  church2xNo: number;
  weekStart: string;
  weekEnd: string;
  month: string;
  lastSyncedAt: string | null;
}

// --- console -------------------------------------------------------
export interface ConsoleStep {
  id: string;
  label: string;
  state: "done" | "attention" | "todo";
  detail: string;
  checked?: boolean;
}
export interface ConsoleView {
  weeksStored: number;
  range: { first: string; last: string } | null;
  latest: string | null;
  latestLabel?: string;
  /** Monday of the most recent complete week; `behind` when latest < this */
  expectedLatest?: string;
  behind?: boolean;
  missingWeeks?: string[];
  counts?: {
    zones: number;
    areasResolved: number;
    areasUnmapped: number;
    stakes: number;
    chase: number;
  };
  friends?: {
    onDate: number;
    baptizedThisMonth: number;
    overdueCount: number;
    lastSyncedAt: string | null;
    syncAgeHours: number | null;
  } | null;
  reconcile?: { month: string; gap: number; stakesWithGap: number } | null;
  steps: ConsoleStep[];
  config: PortalConfig;
  system?: {
    portalEnv: string;
    accessTokenCheck: "off" | "on" | "misconfigured";
    friendsSyncSecretSet: boolean;
    responseCache: boolean;
    missionTimeZone: string;
  };
}

// --- config -----------------------------------------------------
export interface PortalConfig {
  mlcPositions: string[];
  zoneOrder: string[];
  zoneExclude: string[];
  bands: { goalPct: { low: number; mid: number }; mlcShare: { low: number; mid: number } };
  areaBand: { low: number; high: number };
  stakeReportLayout?: StakeReportLayout;
  sheetExtraColumns?: string[];
  sheetExtraHeadersSeen?: string[];
}
export interface ConfigResponse {
  config: PortalConfig;
  defaults: PortalConfig;
  keys: string[];
}

// --- structure ------------------------------------------------
export interface StructureArea {
  key: string;
  displayName: string;
  createdAt: string;
  retiredAt: string | null;
  zone: string | null;
  lastSeen: string | null;
  mappings: {
    imosAreaId: number;
    imosAreaName: string;
    validFrom: string;
    validTo: string | null;
    note: string | null;
    open: boolean;
  }[];
  wards: {
    wardUnitId: number;
    wardName: string;
    stake: string;
    validFrom: string;
    validTo: string | null;
    open: boolean;
  }[];
}
export interface StructureWard {
  wardUnitId: number;
  wardName: string;
  stake: string;
  areas: { key: string; displayName: string }[];
  since: string;
  lastSeen: string | null;
}
export interface Structure {
  areas: StructureArea[];
  wards: StructureWard[];
  stakes: string[];
  zones: string[];
  positionsSeen: string[];
  latestWeek: string | null;
}

// --- rollover -----------------------------------------------
export type Confidence = "high" | "medium" | "low";
export interface RolloverPlan {
  weekStart: string;
  zones: { name: string; status: "unchanged" | "new" | "retired"; areaCount: number }[];
  areas: {
    imosAreaId: number;
    imosAreaName: string;
    zoneName: string;
    mapped: boolean;
    newThisWeek: boolean;
    currentKey: string | null;
    suggestion: {
      canonicalAreaKey: string;
      displayName: string;
      isNew: boolean;
      reason: string;
      confidence: Confidence;
    } | null;
  }[];
  wards: {
    orgId: number;
    orgName: string;
    imosAreaId: number;
    areaName: string;
    mapped: boolean;
    suggestion: {
      canonicalAreaKey: string | null;
      wardName: string;
      stake: string | null;
      reason: string;
      confidence: Confidence;
    };
  }[];
  vanished: {
    imosAreaId: number;
    canonicalAreaKey: string;
    displayName: string;
    validFrom: string;
    otherOpenMappings: number;
    wouldRetire: boolean;
  }[];
  excludedZonesMissing: string[];
  zoneOrderSuggested: string[] | null;
  /** position strings first seen this week; the leadership-looking ones not in the MLC list */
  newPositions?: string[];
  newLeadershipPositions?: string[];
  summary: {
    zonesNew: number;
    zonesRetired: number;
    areasUnmapped: number;
    areasSuggested: number;
    areasNew: number;
    areasVanished: number;
    wardsUnmapped: number;
    wardsSuggested: number;
    clean: boolean;
  };
}
export interface RolloverApplyBody {
  validFrom?: string;
  areas: { imosAreaId: number; canonicalAreaKey: string; isNew: boolean; displayName: string }[];
  wards: { orgId: number; canonicalAreaKey: string; wardName: string; stake: string }[];
  retire?: { imosAreaId: number; canonicalAreaKey: string; validFrom: string }[];
  transferDate?: string;
}
