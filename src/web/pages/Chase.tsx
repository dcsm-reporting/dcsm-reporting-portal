import { api } from "../api.js";
import { ErrorNote, Loading, useAsync, useWeek } from "../lib.js";

export function ChasePage() {
  const { week } = useWeek();
  const { data, err, loading } = useAsync(() => api.chase(week!), [week]);
  if (!week) return <p className="muted">No weeks imported yet.</p>;
  if (loading) return <Loading what="chase list" />;
  if (err) return <ErrorNote err={err} />;
  if (!data) return null;

  return (
    <>
      <h2>Chase list — {data.weekLabel}</h2>
      <p className="muted" style={{ maxWidth: "70ch" }}>
        Areas whose IMOS numbers were not touched during this reporting week (from each area’s{" "}
        <code>history[].modifiedDate</code>). This replaces the old Sunday-night form nudge.
      </p>
      {data.count === 0 ? (
        <div className="note ok">Every active area updated its numbers this week.</div>
      ) : (
        <>
          <div className="note warn">
            <strong>{data.count} area(s)</strong> have stale numbers for {data.weekStart}.
          </div>
          <div className="board-wrap">
            <table className="board">
              <thead>
                <tr>
                  <th className="row-head">Zone</th>
                  <th className="row-head">Area</th>
                  <th className="row-head">Last touched</th>
                </tr>
              </thead>
              <tbody>
                {data.areas.map((a) => (
                  <tr key={a.imosAreaId}>
                    <td className="row-head">{a.zoneName}</td>
                    <td className="row-head">{a.areaName}</td>
                    <td className="row-head mono">{a.lastModified ?? "never"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
