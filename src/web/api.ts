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
async function jpost<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await r.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
  if (!r.ok) throw Object.assign(new Error(data.error ?? `${r.status}`), { data });
  return data as T;
}

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

export interface ChaseView {
  weekStart: string;
  weekLabel: string;
  count: number;
  areas: {
    imosAreaId: number;
    areaName: string;
    zoneName: string;
    lastModified: string | null;
  }[];
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
  importPreview: (rawJson: string) =>
    jpost<{ dryRun: true; summary: ImportSummary }>("/api/import", { rawJson, dryRun: true }),
  importCommit: (rawJson: string) =>
    jpost<{ dryRun: false; summary: ImportSummary; stored: unknown }>("/api/import", {
      rawJson,
      dryRun: false,
    }),
  crosswalk: () =>
    jget<{ canonical: unknown[]; crosswalk: unknown[]; areaWard: unknown[] }>("/api/crosswalk"),
};
