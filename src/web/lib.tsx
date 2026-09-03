import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { KI_IDS, KI_CODE, KI_NAME, type KiId } from "@shared/ki";
import { api, type WeekMeta } from "./api.js";
import type { KiCell } from "@pipeline/types";

export { KI_IDS, KI_CODE, KI_NAME };
export type { KiId };

// --- async data hook ---------------------------------------------------
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; err?: string; loading: boolean }>({
    loading: true,
  });
  const run = useCallback(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, err: undefined }));
    fn().then(
      (data) => live && setState({ data, loading: false }),
      (e) => live && setState({ err: String(e?.message ?? e), loading: false }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(run, [run]);
  return { ...state, reload: run };
}

/** Current user, whether they may view at all, and whether they can edit admin
 *  settings. Cached for the session. */
export interface Me {
  user: string;
  isAdmin: boolean;
  /** false when the account passed Access but is not on the viewer list */
  authorized: boolean;
}
let mePromise: Promise<Me> | null = null;
export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    if (!mePromise)
      mePromise = api
        .me()
        .then((m) => ({ user: m.user, isAdmin: m.isAdmin, authorized: m.authorized !== false }))
        .catch(() => ({ user: "", isAdmin: true, authorized: true }));
    let live = true;
    mePromise.then((m) => live && setMe(m));
    return () => {
      live = false;
    };
  }, []);
  return me;
}

export function Loading({ what }: { what?: string }) {
  return (
    <p className="muted">
      <span className="spin" /> loading{what ? ` ${what}` : ""}…
    </p>
  );
}

export function ErrorNote({ err }: { err: string }) {
  return (
    <div className="note stop">
      <strong>Couldn’t load.</strong> {err}
    </div>
  );
}

// --- week selection (URL-backed) -------------------------------------
interface WeekCtx {
  weeks: WeekMeta[];
  week: string | null;
  setWeek: (w: string) => void;
  /** re-fetch the week list (after an import) */
  refreshWeeks: () => Promise<void>;
  /** zones present in stored data, in the configured order */
  zones: string[];
  /** Monday of the most recent complete week; null until loaded */
  expectedLatest: string | null;
  missing: string[];
}
const Ctx = createContext<WeekCtx>({
  weeks: [],
  week: null,
  setWeek: () => {},
  refreshWeeks: async () => {},
  zones: [],
  expectedLatest: null,
  missing: [],
});
export const useWeek = () => useContext(Ctx);

export function WeekProvider({ children }: { children: React.ReactNode }) {
  const [params, setParams] = useSearchParams();
  const [weeks, setWeeks] = useState<WeekMeta[]>([]);
  const [latest, setLatest] = useState<string | null>(null);
  const [zones, setZones] = useState<string[]>([]);
  const [expectedLatest, setExpectedLatest] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);

  const refreshWeeks = useCallback(async () => {
    const r = await api.weeks();
    setWeeks(r.weeks);
    setLatest(r.latest);
    setZones(r.zones ?? []);
    setExpectedLatest(r.expectedLatest ?? null);
    setMissing(r.missing ?? []);
  }, []);

  useEffect(() => {
    refreshWeeks().catch(() => {});
  }, [refreshWeeks]);

  const week = params.get("w") ?? latest;
  const setWeek = (w: string) => {
    const next = new URLSearchParams(params);
    next.set("w", w);
    setParams(next, { replace: true });
  };

  return (
    <Ctx.Provider value={{ weeks, week, setWeek, refreshWeeks, zones, expectedLatest, missing }}>
      {children}
    </Ctx.Provider>
  );
}

export function WeekPicker() {
  const { weeks, week, setWeek } = useWeek();
  if (weeks.length === 0) return <span className="pill muted">no weeks imported</span>;
  return (
    <span className="wk-picker">
      <select value={week ?? ""} onChange={(e) => setWeek(e.target.value)}>
        {weeks
          .slice()
          .reverse()
          .map((w) => (
            <option key={w.weekStart} value={w.weekStart}>
              {w.weekLabel} · {w.weekStart}
            </option>
          ))}
      </select>
    </span>
  );
}

/**
 * Standard page header: title on the left, an optional week selector on the
 * right. The selector used to live in the masthead; it belongs with the pages
 * that actually vary by week.
 */
export function PageHead({
  title,
  week = false,
  children,
}: {
  title: React.ReactNode;
  week?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-head">
      <h2>{title}</h2>
      <span className="page-head-controls">
        {children}
        {week && (
          <label className="wk-inline">
            <span className="k mono">Week</span>
            <WeekPicker />
          </label>
        )}
      </span>
    </div>
  );
}

// --- KI cell rendering --------------------------------------------
export function bandClass(pct: number | null, lo = 50, mid = 80): string {
  if (pct === null || pct === undefined) return "na";
  if (pct < lo) return "lo";
  if (pct < mid) return "mid";
  return "hi";
}

export function KiHeadCells() {
  return (
    <>
      {KI_IDS.map((ki) => (
        <th key={ki} className="ki-group" title={KI_NAME[ki]}>
          {KI_CODE[ki]}
        </th>
      ))}
    </>
  );
}

export function KiCells({
  row,
  showGoal = true,
  bands,
}: {
  row: Record<number, KiCell>;
  showGoal?: boolean;
  bands?: { low: number; mid: number };
}) {
  return (
    <>
      {KI_IDS.map((ki) => {
        const c = row[ki];
        if (!c) return <td key={ki} className="ki-group">–</td>;
        return (
          <td key={ki} className="ki-group">
            <span className="cell-actual">{c.actual}</span>
            {showGoal && c.goal !== null ? <span className="cell-goal"> /{c.goal}</span> : null}{" "}
            <span className={`pct ${bandClass(c.pct, bands?.low, bands?.mid)}`}>
              {c.pct === null ? "–" : `${c.pct}%`}
            </span>
          </td>
        );
      })}
    </>
  );
}
