import { useState } from "react";
import { BarChart, Bar, ResponsiveContainer, XAxis, Tooltip } from "recharts";
import { api } from "../api.js";
import { ErrorNote, KI_CODE, KI_IDS, Loading, useAsync, useWeek } from "../lib.js";

export function StakesPage() {
  const { week } = useWeek();
  const { data, err, loading } = useAsync(() => api.stakes(week!), [week]);
  const [sel, setSel] = useState<string | null>(null);

  if (!week) return <p className="muted">No weeks imported yet.</p>;
  if (loading) return <Loading what="stakes" />;
  if (err) return <ErrorNote err={err} />;
  if (!data) return null;

  const stake = sel ?? data.stakes[0] ?? null;
  if (!stake) return <p className="muted">No stake rollups yet — seed the crosswalk in Admin.</p>;
  const g = data.byStake[stake]!;
  const wards = Object.keys(g.wards).sort();

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2>Stakes — {data.weekLabel}</h2>
        <select value={stake} onChange={(e) => setSel(e.target.value)}>
          {data.stakes.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
      {stake === "(unmapped)" && (
        <div className="note warn">
          These wards have no crosswalk row for this week. Resolve them in Admin → Crosswalk.
        </div>
      )}

      <div className="board-wrap">
        <table className="board">
          <thead>
            <tr>
              <th className="row-head">Ward</th>
              {KI_IDS.map((ki) => <th key={ki} className="ki-group">{KI_CODE[ki]}</th>)}
            </tr>
          </thead>
          <tbody>
            {wards.map((w) => (
              <tr key={w}>
                <td className="row-head">{w}</td>
                {KI_IDS.map((ki) => <td key={ki} className="ki-group">{g.wards[w]![ki] ?? 0}</td>)}
              </tr>
            ))}
            <tr className="mission">
              <td className="row-head">{stake} total</td>
              {KI_IDS.map((ki) => <td key={ki} className="ki-group">{g.total[ki] ?? 0}</td>)}
            </tr>
          </tbody>
        </table>
      </div>

      <h3>12-week trend</h3>
      <div className="cards" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        {KI_IDS.map((ki) => {
          const code = KI_CODE[ki];
          const rows = (data.stakeSeries[stake] ?? []).map((r) => ({ label: r.label, v: r[code as "NP"] }));
          return (
            <div className="card" key={ki}>
              <div className="k">{code}</div>
              <div style={{ width: "100%", height: 90 }}>
                <ResponsiveContainer>
                  <BarChart data={rows} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                    <XAxis dataKey="label" hide />
                    <Tooltip contentStyle={{ fontSize: 11, background: "var(--surface)", border: "1px solid var(--rule-strong)" }} />
                    <Bar dataKey="v" fill="var(--accent)" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          );
        })}
      </div>
      <p className="muted" style={{ fontSize: ".78rem" }}>
        {data.wardMapSize} ward→stake rows effective this week. Actual counts only — IMOS carries goals at area level, not ward.
      </p>
    </>
  );
}
