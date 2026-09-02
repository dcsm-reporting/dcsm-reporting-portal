import type {
  MlcGrid,
  SeriesRow,
  StakeGrid,
  ZoneGrid,
} from "@pipeline/types";

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
  month: { byZone: ZoneGrid; window: string[]; label: string };
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
  alreadyStored: boolean;
  unmapped: { imosAreaId: number; imosAreaName: string }[];
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

export const api = {
  weeks: () => jget<WeeksResponse>("/api/weeks"),
  week: (w: string) => jget<WeekView>(`/api/week/${w}`),
  trends: (q: { upTo?: string; n?: number; zone?: string | null; mlcOnly?: boolean }) => {
    const p = new URLSearchParams();
    if (q.upTo) p.set("upTo", q.upTo);
    if (q.n) p.set("n", String(q.n));
    if (q.zone) p.set("zone", q.zone);
    if (q.mlcOnly) p.set("mlcOnly", "1");
    return jget<{ rows: SeriesRow[] }>(`/api/trends?${p}`);
  },
  stakes: (w: string) => jget<StakeView>(`/api/stakes/${w}`),
  chase: (w: string) => jget<ChaseView>(`/api/chase/${w}`),
  ackNotReported: (w: string, imosAreaId: number, reason: string) =>
    jpost<{ ok: true }>(`/api/chase/${w}/ack`, { imosAreaId, reason }),
  unackNotReported: (w: string, imosAreaId: number) =>
    jsend<{ ok: true }>("DELETE", `/api/chase/${w}/ack/${imosAreaId}`, undefined),
  importPreview: (rawJson: string) =>
    jpost<{ dryRun: true; summary: ImportSummary }>("/api/import", { rawJson, dryRun: true }),
  importCommit: (rawJson: string) =>
    jpost<{ dryRun: false; summary: ImportSummary; stored: unknown }>("/api/import", {
      rawJson,
      dryRun: false,
    }),
  crosswalk: () =>
    jget<{ canonical: unknown[]; crosswalk: unknown[]; areaWard: unknown[] }>("/api/crosswalk"),

  // --- weekly console -----------------------------------------------
  console: () => jget<ConsoleView>("/api/console"),

  // --- config ------------------------------------------------------
  config: () => jget<ConfigResponse>("/api/config"),
  setConfig: (key: string, value: unknown) =>
    jput<{ ok: true; config: PortalConfig }>("/api/config", { key, value }),

  // --- structure -------------------------------------------------
  structure: () => jget<Structure>("/api/structure"),

  // --- transfer rollover -------------------------------------
  rollover: (w: string) => jget<RolloverPlan>(`/api/rollover/${w}`),
  applyRollover: (w: string, body: RolloverApplyBody) =>
    jpost<{ ok: true; applied: { areas: number; wards: number }; plan: RolloverPlan }>(
      `/api/rollover/${w}/apply`,
      body,
    ),

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
  data: () => jget<DataView>("/api/data"),
  exportUrl: "/api/export",

  // --- publish ---------------------------------------------------
  publish: (week: string) => jget<PublishView>(`/api/publish/${week}`),
  recipients: () => jget<{ recipients: StakeRecipient[] }>("/api/recipients"),
  setRecipient: (r: StakeRecipient) => jpost<{ ok: true }>("/api/recipients", r),
  seedRecipients: () => jpost<{ ok: true; seeded: number }>("/api/recipients/seed", {}),
};

export interface StakeRecipient {
  stake: string;
  presidentName: string | null;
  toEmails: string | null;
  ccEmails: string | null;
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
  }[];
  baptized6mo: { name: string; ward: string | null; baptismDate: string | null; confidence: string | null }[];
  baptizedThisMonth: number;
  baptizedYtd: number;
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
}
export interface FriendsSummary {
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
}
export interface ConsoleView {
  weeksStored: number;
  range: { first: string; last: string } | null;
  latest: string | null;
  latestLabel?: string;
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
}

// --- config -----------------------------------------------------
export interface PortalConfig {
  mlcPositions: string[];
  zoneOrder: string[];
  zoneExclude: string[];
  bands: { goalPct: { low: number; mid: number }; mlcShare: { low: number; mid: number } };
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
export interface Structure {
  areas: StructureArea[];
  stakes: string[];
  zones: string[];
  positionsSeen: string[];
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
  summary: {
    zonesNew: number;
    zonesRetired: number;
    areasUnmapped: number;
    areasSuggested: number;
    areasNew: number;
    wardsUnmapped: number;
    wardsSuggested: number;
    clean: boolean;
  };
}
export interface RolloverApplyBody {
  validFrom?: string;
  areas: { imosAreaId: number; canonicalAreaKey: string; isNew: boolean; displayName: string }[];
  wards: { orgId: number; canonicalAreaKey: string; wardName: string; stake: string }[];
}
