import { api } from "../api.js";
import { ErrorNote, Loading, useAsync } from "../lib.js";

export function DataPage() {
  const { data, err, loading } = useAsync(() => api.data(), []);
  if (loading) return <Loading what="the data log" />;
  if (err) return <ErrorNote err={err} />;
  if (!data) return null;

  return (
    <>
      <h2>Data</h2>
      <p className="muted" style={{ maxWidth: "70ch" }}>
        Read-only. Every raw IMOS payload is kept exactly as imported; the audit log records every
        change made in the portal.
      </p>

      <div className="note">
        <strong>Full backup.</strong> Every table as one JSON file — keep a copy somewhere safe
        before big changes.{" "}
        <a className="btn" href={api.exportUrl} style={{ marginLeft: ".4rem" }}>
          Download full backup (JSON)
        </a>
        <div className="muted" style={{ fontSize: ".8rem", marginTop: ".4rem" }}>
          For schema-level recovery use <code>scripts/backup.sh</code> (see <code>docs/backup.md</code>).
        </div>
      </div>

      <h3>Imported weeks ({data.imports.length})</h3>
      <div className="board-wrap">
        <table className="board">
          <thead>
            <tr>
              <th className="row-head">Week</th>
              <th className="row-head">Imported</th>
              <th className="row-head">By</th>
              <th>KI facts</th>
              <th className="row-head">SHA</th>
              <th className="row-head">Raw</th>
            </tr>
          </thead>
          <tbody>
            {data.imports.map((r) => (
              <tr key={r.weekStart}>
                <td className="row-head mono">{r.weekStart} → {r.weekEnd}</td>
                <td className="row-head mono muted">{r.importedAt.replace("T", " ").slice(0, 16)}</td>
                <td className="row-head muted">{r.importedBy ?? "—"}</td>
                <td>{r.nFacts}</td>
                <td className="row-head mono muted">{r.sha}</td>
                <td className="row-head">
                  <a className="btn" href={`/api/data/raw/${r.weekStart}`}>download</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Friends sheet syncs</h3>
      <div className="board-wrap">
        <table className="board">
          <thead>
            <tr>
              <th className="row-head">When</th>
              <th>Rows in</th>
              <th>Upserted</th>
              <th>Deactivated</th>
              <th className="row-head">Warnings</th>
            </tr>
          </thead>
          <tbody>
            {data.syncs.map((s, i) => (
              <tr key={i}>
                <td className="row-head mono muted">{s.at.replace("T", " ").slice(0, 16)}</td>
                <td>{s.rowsIn}</td>
                <td>{s.upserted}</td>
                <td>{s.deactivated}</td>
                <td className="row-head muted" style={{ fontSize: ".8rem" }}>
                  {s.warnings ? JSON.parse(s.warnings).length : 0}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Audit log</h3>
      <div className="board-wrap">
        <table className="board">
          <thead>
            <tr>
              <th className="row-head">When</th>
              <th className="row-head">Actor</th>
              <th className="row-head">Action</th>
              <th className="row-head">Detail</th>
            </tr>
          </thead>
          <tbody>
            {data.audit.map((a, i) => (
              <tr key={i}>
                <td className="row-head mono muted">{a.at.replace("T", " ").slice(0, 16)}</td>
                <td className="row-head muted">{a.actor}</td>
                <td className="row-head mono">{a.action}</td>
                <td className="row-head muted" style={{ fontSize: ".78rem", maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {a.detail ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
