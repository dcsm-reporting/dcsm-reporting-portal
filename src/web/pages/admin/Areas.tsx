import { useState } from "react";
import { api, type Structure, type StructureArea } from "../../api.js";
import { ErrorNote, Loading, useAsync, useWeek } from "../../lib.js";

export function AreasPage() {
  const { data, err, loading, reload } = useAsync(() => api.structure(), []);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  if (loading) return <Loading what="the structure" />;
  if (err) return <ErrorNote err={err} />;
  if (!data) return null;

  const rows = data.areas.filter((a) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return (
      a.displayName.toLowerCase().includes(s) ||
      a.key.includes(s) ||
      a.wards.some((w) => w.stake.toLowerCase().includes(s) || w.wardName.toLowerCase().includes(s))
    );
  });

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>Canonical areas ({data.areas.length})</h3>
        <input placeholder="filter by area, key, ward, stake…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 260 }} />
      </div>

      <div className="tbl-scroll">
        <table className="grid">
          <thead>
            <tr>
              <th>Area</th>
              <th>Key</th>
              <th>Current IMOS</th>
              <th>Wards</th>
              <th>Stake(s)</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const cur = a.mappings.find((m) => m.open) ?? a.mappings[0];
              const stakes = [...new Set(a.wards.filter((w) => w.open).map((w) => w.stake))];
              return (
                <tr key={a.key} style={{ cursor: "pointer" }} onClick={() => setOpen(open === a.key ? null : a.key)}>
                  <td>{open === a.key ? "▾ " : "▸ "}{a.displayName}</td>
                  <td className="mono">{a.key}</td>
                  <td>{cur ? <>{cur.imosAreaName}<span className="muted mono" style={{ fontSize: ".72rem" }}> #{cur.imosAreaId}</span></> : <span className="muted">none</span>}</td>
                  <td>{a.wards.filter((w) => w.open).length}</td>
                  <td style={{ textAlign: "left" }}>{stakes.map((s) => <span key={s} className="chip" style={{ marginRight: 4 }}>{s}</span>)}</td>
                  <td>{a.retiredAt ? <span className="chip low">retired</span> : <span className="chip high">active</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {open && (() => {
        const a = data.areas.find((x) => x.key === open);
        return a ? <AreaDrawer area={a} onChange={reload} /> : null;
      })()}

      <StakesSection data={data} onChange={reload} />
    </>
  );
}

function AreaDrawer({ area, onChange }: { area: StructureArea; onChange: () => void }) {
  const { week } = useWeek();
  const [name, setName] = useState(area.displayName);
  const [busy, setBusy] = useState(false);
  const vf = week ?? new Date().toISOString().slice(0, 10);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onChange();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="drawer">
      <h4>Rename</h4>
      <div className="inline-form">
        <input value={name} onChange={(e) => setName(e.target.value)} style={{ minWidth: 240 }} />
        <button className="btn" disabled={busy || name === area.displayName} onClick={() => run(() => api.renameCanonical(area.key, name))}>
          Save name
        </button>
        <button
          className="btn"
          disabled={busy}
          onClick={() => run(() => api.retireCanonical(area.key, !area.retiredAt))}
        >
          {area.retiredAt ? "Un-retire area" : "Retire area"}
        </button>
      </div>

      <h4>IMOS id mappings</h4>
      <table className="grid">
        <thead><tr><th>IMOS id</th><th>Name</th><th>From</th><th>To</th><th></th></tr></thead>
        <tbody>
          {area.mappings.map((m) => (
            <tr key={`${m.imosAreaId}-${m.validFrom}`} className={m.open ? "" : "strike"}>
              <td className="mono">#{m.imosAreaId}</td>
              <td>{m.imosAreaName}</td>
              <td className="mono">{m.validFrom}</td>
              <td className="mono">{m.validTo ?? "—"}</td>
              <td>
                {m.open && (
                  <button className="btn" disabled={busy} onClick={() => run(() => api.closeMapping(m.imosAreaId, m.validFrom, vf))}>
                    Close at {vf}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <AttachMapping areaKey={area.key} vf={vf} onDone={onChange} />

      <h4>Ward → stake rows</h4>
      <table className="grid">
        <thead><tr><th>Unit</th><th>Ward</th><th>Stake</th><th>From</th><th>To</th><th></th></tr></thead>
        <tbody>
          {area.wards.map((w) => (
            <tr key={`${w.wardUnitId}-${w.validFrom}`} className={w.open ? "" : "strike"}>
              <td className="mono">{w.wardUnitId}</td>
              <td>{w.wardName}</td>
              <td>{w.stake}</td>
              <td className="mono">{w.validFrom}</td>
              <td className="mono">{w.validTo ?? "—"}</td>
              <td>
                {w.open && (
                  <button className="btn" disabled={busy} onClick={() => run(() => api.closeWard(area.key, w.wardUnitId, w.validFrom, vf))}>
                    Retire at {vf}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <AddWard areaKey={area.key} vf={vf} onDone={onChange} />
    </div>
  );
}

function AttachMapping({ areaKey, vf, onDone }: { areaKey: string; vf: string; onDone: () => void }) {
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="inline-form">
      <input placeholder="new IMOS area id" value={id} onChange={(e) => setId(e.target.value)} style={{ width: 150 }} />
      <button
        className="btn"
        disabled={busy || !id.trim()}
        onClick={async () => {
          setBusy(true);
          try {
            await api.attachArea(Number(id), areaKey, vf);
            setId("");
            onDone();
          } finally {
            setBusy(false);
          }
        }}
      >
        Point id → {areaKey} from {vf}
      </button>
    </div>
  );
}

function AddWard({ areaKey, vf, onDone }: { areaKey: string; vf: string; onDone: () => void }) {
  const [f, setF] = useState({ wardUnitId: "", wardName: "", stake: "" });
  const [busy, setBusy] = useState(false);
  const ok = f.wardUnitId.trim() && f.wardName.trim() && f.stake.trim();
  return (
    <div className="inline-form">
      <input placeholder="unit id" value={f.wardUnitId} onChange={(e) => setF({ ...f, wardUnitId: e.target.value })} style={{ width: 110 }} />
      <input placeholder="ward name" value={f.wardName} onChange={(e) => setF({ ...f, wardName: e.target.value })} />
      <input placeholder="stake" value={f.stake} onChange={(e) => setF({ ...f, stake: e.target.value })} />
      <button
        className="btn"
        disabled={busy || !ok}
        onClick={async () => {
          setBusy(true);
          try {
            await api.addWard({
              canonicalAreaKey: areaKey,
              wardUnitId: Number(f.wardUnitId),
              wardName: f.wardName,
              stake: f.stake,
              validFrom: vf,
            });
            setF({ wardUnitId: "", wardName: "", stake: "" });
            onDone();
          } finally {
            setBusy(false);
          }
        }}
      >
        Add ward row
      </button>
    </div>
  );
}

function StakesSection({ data, onChange }: { data: Structure; onChange: () => void }) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <>
      <h3 style={{ marginTop: "2.4rem" }}>Stakes ({data.stakes.length})</h3>
      <p className="muted" style={{ fontSize: ".85rem" }}>Renaming updates every ward row under that stake.</p>
      <table className="grid" style={{ maxWidth: 560 }}>
        <tbody>
          {data.stakes.map((s) => (
            <tr key={s}>
              <td style={{ width: "50%" }}>
                <input value={edits[s] ?? s} onChange={(e) => setEdits((m) => ({ ...m, [s]: e.target.value }))} />
              </td>
              <td>
                <button
                  className="btn"
                  disabled={busy === s || (edits[s] ?? s) === s}
                  onClick={async () => {
                    setBusy(s);
                    try {
                      await api.renameStake(s, edits[s]!);
                      onChange();
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  Rename
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
