import { useState } from "react";
import { api } from "../api.js";
import { ErrorNote, Loading, useAsync, useWeek } from "../lib.js";

export function AdminPage() {
  const { week } = useWeek();
  const cw = useAsync(() => api.crosswalk(), []);
  const wk = useAsync(() => (week ? api.week(week) : Promise.resolve(null)), [week]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function seed() {
    if (!week) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/seed", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ weekStart: week }),
      });
      const d = (await r.json()) as {
        error?: string;
        counts: { canonicalAreas: number; areaCrosswalk: number; areaWard: number };
        unresolved: string[];
      };
      if (!r.ok) throw new Error(d.error);
      setMsg(
        `Seeded from ${week}: ${d.counts.canonicalAreas} canonical areas, ` +
          `${d.counts.areaCrosswalk} crosswalk rows, ${d.counts.areaWard} ward rows` +
          (d.unresolved.length ? ` · ${d.unresolved.length} unresolved` : " · all resolved"),
      );
      cw.reload();
      wk.reload();
    } catch (e) {
      setMsg(`Seed failed: ${String((e as Error).message)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h2>Admin</h2>

      <h3>Crosswalk</h3>
      {cw.loading && <Loading what="crosswalk" />}
      {cw.err && <ErrorNote err={cw.err} />}
      {cw.data && (
        <div className="cards">
          <div className="card">
            <div className="k">Canonical areas</div>
            <div className="v">{cw.data.canonical.length}</div>
          </div>
          <div className="card">
            <div className="k">Crosswalk rows</div>
            <div className="v">{cw.data.crosswalk.length}</div>
          </div>
          <div className="card">
            <div className="k">Ward → stake rows</div>
            <div className="v">{cw.data.areaWard.length}</div>
          </div>
        </div>
      )}

      <div className="row">
        <button className="btn" onClick={seed} disabled={busy || !week}>
          {busy ? "Seeding…" : `Seed crosswalk from ${week ?? "—"}`}
        </button>
        <span className="muted" style={{ fontSize: ".8rem" }}>
          Run once per mission structure (pre- and post-transfer). Idempotent.
        </span>
      </div>
      {msg && <div className="note">{msg}</div>}

      <h3>Unmapped areas — {week ?? "no week"}</h3>
      {wk.loading && <Loading />}
      {wk.data && wk.data.resolve.unmapped.length === 0 && (
        <div className="note ok">Every area for this week resolves to a canonical key.</div>
      )}
      {wk.data && wk.data.resolve.unmapped.length > 0 && (
        <AttachList
          week={week!}
          rows={wk.data.resolve.unmapped}
          onDone={() => {
            wk.reload();
            cw.reload();
          }}
        />
      )}
    </>
  );
}

function AttachList({
  week,
  rows,
  onDone,
}: {
  week: string;
  rows: { imosAreaId: number; imosAreaName: string }[];
  onDone: () => void;
}) {
  const [keys, setKeys] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);

  async function attach(id: number) {
    const key = (keys[id] ?? "").trim();
    if (!key) return;
    setBusy(true);
    try {
      // create the canonical area if new, then point the IMOS id at it
      await fetch("/api/crosswalk/canonical", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, displayName: rows.find((r) => r.imosAreaId === id)?.imosAreaName ?? key }),
      });
      await fetch("/api/crosswalk/attach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imosAreaId: id, canonicalAreaKey: key, validFrom: week }),
      });
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <table className="grid">
      <thead>
        <tr>
          <th>IMOS area</th>
          <th>id</th>
          <th>attach to canonical key</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.imosAreaId}>
            <td>{r.imosAreaName}</td>
            <td className="mono">{r.imosAreaId}</td>
            <td>
              <input
                value={keys[r.imosAreaId] ?? ""}
                placeholder="e.g. fairfax"
                onChange={(e) => setKeys((k) => ({ ...k, [r.imosAreaId]: e.target.value }))}
              />
            </td>
            <td>
              <button className="btn" disabled={busy} onClick={() => attach(r.imosAreaId)}>
                Attach
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
