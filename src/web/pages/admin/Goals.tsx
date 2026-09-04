import { useMemo, useState } from "react";
import { api } from "../../api.js";
import { ErrorNote, Loading, useAsync, useWeek } from "../../lib.js";
import { todayIso } from "@shared/dates";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Admin → Baptism goals. Optional monthly and annual goals for the mission and
 * each zone. Blank means no goal. Every month is editable, past ones included,
 * so a goal set late or corrected after the fact still lines up with history.
 */
export function GoalsPage() {
  const { zones: liveZones } = useWeek();
  const thisYear = todayIso().slice(0, 4);
  const [year, setYear] = useState(thisYear);
  const data = useAsync(() => api.goals(year), [year]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const zones = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const z of [...(liveZones ?? []), ...(data.data?.zones ?? [])]) {
      if (!seen.has(z)) {
        seen.add(z);
        out.push(z);
      }
    }
    return out;
  }, [liveZones, data.data]);

  const periods = useMemo(() => [...(data.data?.months ?? []), year], [data.data, year]);
  const stored = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of data.data?.rows ?? []) m.set(`${r.period}|${r.zone}`, r.goal);
    return m;
  }, [data.data]);

  const key = (period: string, zone: string) => `${period}|${zone}`;
  const valueOf = (period: string, zone: string): string =>
    edits[key(period, zone)] ?? (stored.has(key(period, zone)) ? String(stored.get(key(period, zone))) : "");
  const derivedMission = (period: string): number | null => {
    let sum = 0;
    let anyZone = false;
    for (const z of zones) {
      const v = valueOf(period, z);
      if (v !== "" && !Number.isNaN(parseInt(v, 10))) {
        sum += parseInt(v, 10);
        anyZone = true;
      }
    }
    return anyZone ? sum : null;
  };
  const actual = (period: string, zone: string) => data.data?.actuals?.[period]?.[zone] ?? 0;
  const dirty = Object.keys(edits).length > 0;

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const entries = Object.entries(edits).map(([k, v]) => {
        const [period, zone] = k.split("|");
        const n = v.trim() === "" ? null : parseInt(v, 10);
        return { period: period!, zone: zone ?? "", goal: n === null || Number.isNaN(n) ? null : n };
      });
      const res = await api.setGoals(entries);
      setEdits({});
      setMsg(`Saved: ${res.written} goal${res.written === 1 ? "" : "s"} set, ${res.removed} cleared.`);
      data.reload();
    } catch (e) {
      setMsg(String((e as Error).message ?? e));
    } finally {
      setSaving(false);
    }
  }

  const years = [String(parseInt(thisYear, 10) - 1), thisYear, String(parseInt(thisYear, 10) + 1)];
  if (!years.includes(year)) years.push(year);

  return (
    <>
      <h3>Baptism goals</h3>
      <p className="muted" style={{ maxWidth: "62ch" }}>
        Optional. Leave a cell blank for no goal. A blank mission cell is the sum of the zone goals for
        that period. Every month can be edited, past months included. Goals appear on the Baptisms page,
        the Trends chart, the Monday deck's zone chips, and the stake report when its headline tile is on.
        The small number under each cell is the confirmed baptisms recorded for that period.
      </p>

      <div className="row" style={{ gap: ".6rem", alignItems: "center", margin: ".6rem 0 1rem" }}>
        <label className="row" style={{ gap: ".4rem" }}>
          <span className="k mono">Year</span>
          <select value={year} onChange={(e) => (setEdits({}), setYear(e.target.value))}>
            {years.sort().map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>
        <button className="primary" disabled={!dirty || saving} onClick={save}>
          {saving ? "Saving…" : dirty ? `Save ${Object.keys(edits).length} change${Object.keys(edits).length === 1 ? "" : "s"}` : "Saved"}
        </button>
        {dirty && (
          <button onClick={() => setEdits({})} disabled={saving}>Discard</button>
        )}
        {msg && <span className="muted" style={{ fontSize: ".85rem" }}>{msg}</span>}
      </div>

      {data.loading && <Loading what="goals" />}
      {data.err && <ErrorNote err={data.err} />}
      {data.data && (
        <div style={{ overflowX: "auto" }}>
          <table className="grid" style={{ fontSize: ".85rem" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>{year}</th>
                {periods.map((p) => (
                  <th key={p} style={{ textAlign: "center", minWidth: 62 }}>
                    {p.length === 4 ? "Year" : MON[parseInt(p.slice(5), 10) - 1]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {["", ...zones].map((zone) => (
                <tr key={zone || "__mission"}>
                  <td className="row-head" style={{ fontWeight: zone ? 500 : 700, whiteSpace: "nowrap" }}>
                    {zone || "Mission"}
                  </td>
                  {periods.map((p) => {
                    const v = valueOf(p, zone);
                    const derived = zone === "" && v === "" ? derivedMission(p) : null;
                    const edited = key(p, zone) in edits;
                    return (
                      <td key={p} style={{ textAlign: "center", padding: "2px 4px" }}>
                        <input
                          type="number"
                          min={0}
                          max={9999}
                          value={v}
                          placeholder={derived !== null ? String(derived) : ""}
                          title={derived !== null ? `Sum of the zone goals: ${derived}` : undefined}
                          onChange={(e) => setEdits({ ...edits, [key(p, zone)]: e.target.value })}
                          style={{
                            width: 56,
                            textAlign: "center",
                            fontWeight: zone ? 400 : 600,
                            background: edited ? "var(--warn-wash)" : undefined,
                          }}
                          aria-label={`${zone || "Mission"} ${p}`}
                        />
                        <div className="muted" style={{ fontSize: ".7rem", lineHeight: 1.2, marginTop: 2 }}>
                          {actual(p, zone) || "·"}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted" style={{ fontSize: ".78rem", marginTop: ".8rem" }}>
        Zones come from the imported weeks and from goals already set. A zone that no longer exists keeps
        its past goals; a new zone appears here after its first import.
      </p>
    </>
  );
}
