import { useState } from "react";
import { api } from "../../api.js";
import { ErrorNote, Loading, useAsync } from "../../lib.js";

type Row = Record<string, unknown>;

export function CrosswalkRawPage() {
  const { data, err, loading } = useAsync(() => api.crosswalk(), []);
  const [tab, setTab] = useState<"canonical" | "crosswalk" | "areaWard">("crosswalk");
  const [q, setQ] = useState("");

  if (loading) return <Loading what="crosswalk tables" />;
  if (err) return <ErrorNote err={err} />;
  if (!data) return null;

  const rows = (data[tab] as Row[]) ?? [];
  const cols = rows.length ? Object.keys(rows[0]!) : [];
  const filtered = q.trim()
    ? rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q.trim().toLowerCase()))
    : rows;

  return (
    <>
      <p className="muted" style={{ fontSize: ".85rem" }}>
        Read-only view of the raw crosswalk tables, for debugging. Edit through Rollover and Areas.
      </p>
      <div className="row">
        {(["crosswalk", "areaWard", "canonical"] as const).map((t) => (
          <button key={t} className={`btn ${tab === t ? "primary" : ""}`} onClick={() => setTab(t)}>
            {t} ({(data[t] as unknown[]).length})
          </button>
        ))}
        <input placeholder="filter…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="tbl-scroll" style={{ marginTop: ".8rem" }}>
        <table className="grid">
          <thead>
            <tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {filtered.slice(0, 500).map((r, i) => (
              <tr key={i}>
                {cols.map((c) => (
                  <td key={c} className="mono" style={{ fontSize: ".76rem", textAlign: "left" }}>
                    {r[c] === null ? "–" : String(r[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length > 500 && <p className="muted">showing first 500 of {filtered.length}</p>}
    </>
  );
}
