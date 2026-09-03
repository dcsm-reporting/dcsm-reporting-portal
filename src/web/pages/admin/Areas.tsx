import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Structure, type StructureArea, type StructureWard } from "../../api.js";
import { ErrorNote, Loading, useAsync, useWeek } from "../../lib.js";
import { mondayOf, todayIso } from "@shared/dates";

/**
 * Areas & wards. Organised around the things that actually happen to a
 * mission's map, not around the tables underneath:
 *
 *   teaching areas change   → IMOS tells us; import the week, run Rollover
 *   a ward changes stake    → "Move wards to a stake" (boundary change, new stake, merge)
 *   a ward is renamed       → "Rename a ward" (also a branch becoming a ward)
 *   a ward is dissolved     → "Retire a ward" (split / merge away; the new unit arrives via IMOS)
 *   a stake is renamed      → "Rename a stake"
 *
 * Every change is effective-dated by reporting week (a Monday). Earlier weeks
 * keep what they had.
 */
export function AreasPage() {
  const { data, err, loading, reload } = useAsync(() => api.structure(), []);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [view, setView] = useState<"areas" | "wards">("areas");
  const [flash, setFlash] = useState<string | null>(null);
  const say = (m: string) => {
    setFlash(m);
    setTimeout(() => setFlash(null), 4000);
    reload();
  };

  if (loading) return <Loading what="the structure" />;
  if (err) return <ErrorNote err={err} />;
  if (!data) return null;

  const s = q.trim().toLowerCase();
  const areaRows = data.areas.filter((a) => {
    if (!s) return true;
    return (
      a.displayName.toLowerCase().includes(s) ||
      a.key.includes(s) ||
      (a.zone ?? "").toLowerCase().includes(s) ||
      a.wards.some((w) => w.stake.toLowerCase().includes(s) || w.wardName.toLowerCase().includes(s))
    );
  });
  const wardRows = (data.wards ?? []).filter((w) => {
    if (!s) return true;
    return (
      w.wardName.toLowerCase().includes(s) ||
      w.stake.toLowerCase().includes(s) ||
      String(w.wardUnitId).includes(s) ||
      w.areas.some((a) => a.displayName.toLowerCase().includes(s))
    );
  });

  return (
    <>
      <QuickActions data={data} onDone={say} />
      {flash && <div className="note ok">{flash}</div>}

      <div className="row" style={{ justifyContent: "space-between", marginTop: "1.4rem" }}>
        <span className="seg">
          <button className={view === "areas" ? "on" : ""} onClick={() => setView("areas")}>
            Teaching areas ({data.areas.filter((a) => !a.retiredAt).length})
          </button>
          <button className={view === "wards" ? "on" : ""} onClick={() => setView("wards")}>
            Units ({(data.wards ?? []).length})
          </button>
        </span>
        <input placeholder="filter by area, ward, stake, zone…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 260 }} />
      </div>

      {view === "areas" ? (
        <>
          <p className="muted" style={{ fontSize: ".82rem", maxWidth: "76ch" }}>
            One row per teaching area the mission has ever had. The name is the portal's own; the
            IMOS id and zone are whatever IMOS last reported. Click a row for its full id history
            and ward rows. New, split, and merged areas arrive through the weekly import and are
            mapped in <Link to="/admin/rollover">Rollover</Link>, not here.
          </p>
          <div className="tbl-scroll">
            <table className="grid">
              <thead>
                <tr>
                  <th>Area</th>
                  <th>Zone</th>
                  <th>IMOS id</th>
                  <th>Unit(s)</th>
                  <th>Stake</th>
                  <th>Last reported</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {areaRows.map((a) => {
                  const cur = a.mappings.find((m) => m.open) ?? a.mappings[0];
                  const openWards = a.wards.filter((w) => w.open);
                  const stakes = [...new Set(openWards.map((w) => w.stake))];
                  const isOpen = open === a.key;
                  const stale = data.latestWeek && a.lastSeen && a.lastSeen < data.latestWeek && !a.retiredAt;
                  return (
                    <Fragment key={a.key}>
                      <tr style={{ cursor: "pointer" }} onClick={() => setOpen(isOpen ? null : a.key)}>
                        <td>
                          {isOpen ? "▾ " : "▸ "}{a.displayName}
                          <div className="muted mono" style={{ fontSize: ".7rem" }}>{a.key}</div>
                        </td>
                        <td>{a.zone ?? <span className="muted">–</span>}</td>
                        <td className="mono" style={{ fontSize: ".78rem" }}>
                          {cur ? `#${cur.imosAreaId}` : <span className="muted">none</span>}
                          {cur && cur.imosAreaName !== a.displayName && (
                            <div className="muted" style={{ fontSize: ".7rem" }}>IMOS: {cur.imosAreaName}</div>
                          )}
                        </td>
                        <td style={{ textAlign: "left" }}>
                          {openWards.length === 0 ? (
                            <span className="muted">none</span>
                          ) : (
                            openWards.map((w) => w.wardName).join(", ")
                          )}
                        </td>
                        <td style={{ textAlign: "left" }}>
                          {stakes.map((st) => <span key={st} className="chip" style={{ marginRight: 4 }}>{st}</span>)}
                        </td>
                        <td className="mono" style={{ fontSize: ".78rem" }}>
                          {a.lastSeen ?? <span className="muted">never</span>}
                          {stale && <span className="chip medium" style={{ marginLeft: 6 }}>not in latest week</span>}
                        </td>
                        <td>{a.retiredAt ? <span className="chip low">retired {a.retiredAt}</span> : <span className="chip high">active</span>}</td>
                      </tr>
                      {isOpen && (
                        <tr className="row-expand">
                          <td colSpan={7} style={{ padding: 0 }}>
                            <AreaDrawer area={a} onChange={reload} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <p className="muted" style={{ fontSize: ".82rem", maxWidth: "76ch" }}>
            One row per unit, ward or branch (IMOS org id). The stake here is what puts a unit’s numbers on a stake
            president’s report. Use the quick actions above to move, rename, or retire a unit; a
            brand-new unit appears in <Link to="/admin/rollover">Rollover</Link> the week IMOS first
            reports it.
          </p>
          <div className="tbl-scroll">
            <table className="grid">
              <thead>
                <tr>
                  <th>Unit</th>
                  <th>Stake</th>
                  <th>Covered by</th>
                  <th>Org id</th>
                  <th>Stake since</th>
                  <th>Last reported</th>
                </tr>
              </thead>
              <tbody>
                {wardRows.map((w) => (
                  <tr key={w.wardUnitId}>
                    <td>{w.wardName}</td>
                    <td><span className="chip">{w.stake}</span></td>
                    <td style={{ textAlign: "left" }}>
                      {w.areas.length ? w.areas.map((a) => a.displayName).join(", ") : <span className="muted">no area</span>}
                    </td>
                    <td className="mono" style={{ fontSize: ".78rem" }}>#{w.wardUnitId}</td>
                    <td className="mono" style={{ fontSize: ".78rem" }}>{w.since}</td>
                    <td className="mono" style={{ fontSize: ".78rem" }}>
                      {w.lastSeen ?? <span className="muted">never</span>}
                      {data.latestWeek && w.lastSeen && w.lastSeen < data.latestWeek && (
                        <span className="chip medium" style={{ marginLeft: 6 }}>not in latest week</span>
                      )}
                    </td>
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

// ---------------------------------------------------------------------------
// Quick actions: the five things that happen to wards and stakes

type Action = "move" | "rename" | "retire" | "stake" | null;

function QuickActions({ data, onDone }: { data: Structure; onDone: (m: string) => void }) {
  const [action, setAction] = useState<Action>(null);
  const { week } = useWeek();
  const defaultWeek = week ?? mondayOf(todayIso());
  return (
    <div className="drawer">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <strong>Something changed?</strong>
        <span className="row" style={{ gap: ".4rem", flexWrap: "wrap" }}>
          <button className={`btn${action === "move" ? " primary" : ""}`} onClick={() => setAction(action === "move" ? null : "move")}>
            Units moved to a stake
          </button>
          <button className={`btn${action === "rename" ? " primary" : ""}`} onClick={() => setAction(action === "rename" ? null : "rename")}>
            Unit renamed / branch became a ward
          </button>
          <button className={`btn${action === "retire" ? " primary" : ""}`} onClick={() => setAction(action === "retire" ? null : "retire")}>
            Unit dissolved
          </button>
          <button className={`btn${action === "stake" ? " primary" : ""}`} onClick={() => setAction(action === "stake" ? null : "stake")}>
            Stake renamed
          </button>
          <Link className="btn" to="/admin/rollover">New or changed teaching areas →</Link>
        </span>
      </div>
      {action === null && (
        <p className="muted" style={{ fontSize: ".82rem", margin: ".5rem 0 0", maxWidth: "80ch" }}>
          Teaching areas and zones come from IMOS every week and are mapped in Rollover. Wards and
          stakes are the mission's own record, so changes to them are made here. Every change is
          dated by reporting week; earlier weeks keep what they had. A new stake is created simply
          by moving wards to a name that does not exist yet, then adding its recipients.
        </p>
      )}
      {action === "move" && <MoveWards data={data} defaultWeek={defaultWeek} onDone={(m) => (setAction(null), onDone(m))} />}
      {action === "rename" && <RenameWard data={data} onDone={(m) => (setAction(null), onDone(m))} />}
      {action === "retire" && <RetireWard data={data} defaultWeek={defaultWeek} onDone={(m) => (setAction(null), onDone(m))} />}
      {action === "stake" && <RenameStake data={data} onDone={(m) => (setAction(null), onDone(m))} />}
    </div>
  );
}

function WardPicker({
  data,
  value,
  onChange,
  multi,
}: {
  data: Structure;
  value: number[];
  onChange: (ids: number[]) => void;
  multi: boolean;
}) {
  const byStake = useMemo(() => {
    const m = new Map<string, StructureWard[]>();
    for (const w of data.wards ?? []) (m.get(w.stake) ?? m.set(w.stake, []).get(w.stake)!).push(w);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [data.wards]);
  return (
    <select
      multiple={multi}
      size={multi ? 10 : undefined}
      value={multi ? value.map(String) : String(value[0] ?? "")}
      onChange={(e) =>
        onChange(
          multi
            ? [...e.target.selectedOptions].map((o) => Number(o.value))
            : e.target.value ? [Number(e.target.value)] : [],
        )
      }
      style={{ minWidth: 320, fontSize: ".85rem" }}
    >
      {!multi && <option value="">choose a unit…</option>}
      {byStake.map(([stake, wards]) => (
        <optgroup key={stake} label={stake}>
          {wards.map((w) => (
            <option key={w.wardUnitId} value={w.wardUnitId}>
              {w.wardName} · #{w.wardUnitId}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function useBusy() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMsg(null);
    try {
      return await fn();
    } catch (e) {
      setMsg(`Failed: ${(e as Error).message}`);
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { busy, msg, run };
}

function MoveWards({ data, defaultWeek, onDone }: { data: Structure; defaultWeek: string; onDone: (m: string) => void }) {
  const [ids, setIds] = useState<number[]>([]);
  const [stake, setStake] = useState("");
  const [from, setFrom] = useState(defaultWeek);
  const { busy, msg, run } = useBusy();
  const isNewStake = stake.trim() && !data.stakes.some((s) => s.toLowerCase() === stake.trim().toLowerCase());
  return (
    <div style={{ marginTop: ".8rem" }}>
      <p className="muted" style={{ fontSize: ".82rem", maxWidth: "80ch" }}>
        For a boundary change, a new stake, or a stake merging into another. Pick the units (Ctrl-click
        for several), type the stake they now belong to, and the first reporting week it applies. Their
        numbers land on the new stake's report from that week; the old stake keeps the earlier weeks.
      </p>
      <div className="inline-form" style={{ alignItems: "flex-start" }}>
        <WardPicker data={data} value={ids} onChange={setIds} multi />
        <div>
          <label className="field"><span className="k mono">New stake</span>
            <input list="stake-names" value={stake} onChange={(e) => setStake(e.target.value)} placeholder="existing or new name" />
            <datalist id="stake-names">{data.stakes.map((s) => <option key={s} value={s} />)}</datalist>
          </label>
          {isNewStake && (
            <div className="muted" style={{ fontSize: ".78rem" }}>
              “{stake.trim()}” is a new stake. After moving, add its recipients under <Link to="/admin/recipients">Stake reports</Link>.
            </div>
          )}
          <label className="field"><span className="k mono">From week (Monday)</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <button
            className="btn primary"
            disabled={busy || ids.length === 0 || !stake.trim() || !from}
            onClick={async () => {
              const m = await run(async () => {
                const r = await api.moveWards(ids, stake.trim(), mondayOf(from));
                return `Moved ${ids.length} unit${ids.length === 1 ? "" : "s"} to ${stake.trim()} from ${mondayOf(from)} (${r.changed} row${r.changed === 1 ? "" : "s"} updated).`;
              });
              if (m) onDone(m);
            }}
          >
            {busy ? "Moving…" : `Move ${ids.length} unit${ids.length === 1 ? "" : "s"}`}
          </button>
          {msg && <div className="note stop" style={{ marginTop: ".5rem" }}>{msg}</div>}
        </div>
      </div>
    </div>
  );
}

function RenameWard({ data, onDone }: { data: Structure; onDone: (m: string) => void }) {
  const [ids, setIds] = useState<number[]>([]);
  const [name, setName] = useState("");
  const { busy, msg, run } = useBusy();
  const cur = (data.wards ?? []).find((w) => w.wardUnitId === ids[0]);
  return (
    <div style={{ marginTop: ".8rem" }}>
      <p className="muted" style={{ fontSize: ".82rem", maxWidth: "80ch" }}>
        Changes the name shown on the stake reports. The unit keeps its org id and its history, so this
        is also the right action when a branch becomes a ward (or the reverse). The name IMOS reports
        is unaffected and still shows on the This Week board.
      </p>
      <div className="inline-form">
        <WardPicker data={data} value={ids} onChange={(v) => (setIds(v), setName((data.wards ?? []).find((w) => w.wardUnitId === v[0])?.wardName ?? ""))} multi={false} />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="new name" style={{ minWidth: 220 }} />
        <button
          className="btn primary"
          disabled={busy || !cur || !name.trim() || name.trim() === cur.wardName}
          onClick={async () => {
            const m = await run(async () => {
              await api.renameWard(cur!.wardUnitId, name.trim());
              return `Renamed ${cur!.wardName} to ${name.trim()}.`;
            });
            if (m) onDone(m);
          }}
        >
          {busy ? "Renaming…" : "Rename"}
        </button>
      </div>
      {msg && <div className="note stop" style={{ marginTop: ".5rem" }}>{msg}</div>}
    </div>
  );
}

function RetireWard({ data, defaultWeek, onDone }: { data: Structure; defaultWeek: string; onDone: (m: string) => void }) {
  const [ids, setIds] = useState<number[]>([]);
  const [into, setInto] = useState<number[]>([]);
  const [to, setTo] = useState(defaultWeek);
  const { busy, msg, run } = useBusy();
  const cur = (data.wards ?? []).find((w) => w.wardUnitId === ids[0]);
  const target = (data.wards ?? []).find((w) => w.wardUnitId === into[0]);
  return (
    <div style={{ marginTop: ".8rem" }}>
      <p className="muted" style={{ fontSize: ".82rem", maxWidth: "80ch" }}>
        For a unit dissolved, or merged into another unit. Its rows are closed from the week you
        give; earlier weeks keep it on its stake. Members who moved to another unit are reported by
        that unit from now on, under its own org id, so nothing else needs to change. If the Church
        created a brand-new unit in its place, it arrives through the weekly import and is mapped in
        Rollover. If IMOS keeps reporting under the old org id, do not retire it; rename it instead.
      </p>
      <div className="inline-form" style={{ alignItems: "flex-end" }}>
        <label className="field" style={{ margin: 0 }}><span className="k mono">Unit</span>
          <WardPicker data={data} value={ids} onChange={setIds} multi={false} />
        </label>
        <label className="field" style={{ margin: 0 }}><span className="k mono">Merged into (optional)</span>
          <WardPicker data={data} value={into} onChange={setInto} multi={false} />
        </label>
        <label className="field" style={{ margin: 0 }}><span className="k mono">Last week on report</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button
          className="btn"
          disabled={busy || !cur || !to || (!!target && target.wardUnitId === cur.wardUnitId)}
          onClick={async () => {
            const what = target ? `Merge ${cur!.wardName} into ${target.wardName} and retire it` : `Retire ${cur!.wardName}`;
            if (!window.confirm(`${what} from ${mondayOf(to)} onward?`)) return;
            const m = await run(async () => {
              const r = await api.retireWard(cur!.wardUnitId, mondayOf(to), target?.wardUnitId ?? null);
              return `${target ? `Merged ${cur!.wardName} into ${target.wardName}; retired` : `Retired ${cur!.wardName}`} at ${mondayOf(to)} (${r.changed} row${r.changed === 1 ? "" : "s"} closed).`;
            });
            if (m) onDone(m);
          }}
        >
          {busy ? "Working…" : target ? "Merge and retire" : "Retire unit"}
        </button>
      </div>
      {msg && <div className="note stop" style={{ marginTop: ".5rem" }}>{msg}</div>}
    </div>
  );
}

function RenameStake({ data, onDone }: { data: Structure; onDone: (m: string) => void }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const { busy, msg, run } = useBusy();
  return (
    <div style={{ marginTop: ".8rem" }}>
      <p className="muted" style={{ fontSize: ".82rem", maxWidth: "80ch" }}>
        Renames the stake everywhere it is stored by name: every unit row, the report recipients, and
        the stake on baptism records. Tell the STLs to use the new spelling on the sheet.
      </p>
      <div className="inline-form">
        <select value={from} onChange={(e) => (setFrom(e.target.value), setTo(e.target.value))}>
          <option value="">choose a stake…</option>
          {data.stakes.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="new name" style={{ minWidth: 220 }} />
        <button
          className="btn primary"
          disabled={busy || !from || !to.trim() || to.trim() === from}
          onClick={async () => {
            const m = await run(async () => {
              const r = await api.renameStake(from, to.trim());
              return `Renamed ${from} to ${to.trim()} (${r.changed} unit row${r.changed === 1 ? "" : "s"}).`;
            });
            if (m) onDone(m);
          }}
        >
          {busy ? "Renaming…" : "Rename stake"}
        </button>
      </div>
      {msg && <div className="note stop" style={{ marginTop: ".5rem" }}>{msg}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-area drawer: the full dated record (technical depth lives here)

function AreaDrawer({ area, onChange }: { area: StructureArea; onChange: () => void }) {
  const { week } = useWeek();
  const [name, setName] = useState(area.displayName);
  const [busy, setBusy] = useState(false);
  const vf = week ?? mondayOf(todayIso());

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
      <h4>Name shown on reports</h4>
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

      <h4>IMOS ids this area has had</h4>
      <p className="muted" style={{ fontSize: ".8rem", margin: "0 0 .4rem" }}>
        Each row says "for weeks from … to …, IMOS id N was this area". Rollover writes these; close
        or attach one by hand only to correct a mistake.
      </p>
      <table className="grid">
        <thead><tr><th>IMOS id</th><th>Name in IMOS</th><th>From</th><th>To</th><th>Note</th><th></th></tr></thead>
        <tbody>
          {area.mappings.map((m) => (
            <tr key={`${m.imosAreaId}-${m.validFrom}`} className={m.open ? "" : "strike"}>
              <td className="mono">#{m.imosAreaId}</td>
              <td>{m.imosAreaName}</td>
              <td className="mono">{m.validFrom}</td>
              <td className="mono">{m.validTo ?? "–"}</td>
              <td className="muted" style={{ fontSize: ".78rem" }}>{m.note ?? ""}</td>
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

      <h4>Units this area covers</h4>
      <table className="grid">
        <thead><tr><th>Org id</th><th>Unit</th><th>Stake</th><th>From</th><th>To</th><th></th></tr></thead>
        <tbody>
          {area.wards.map((w) => (
            <tr key={`${w.wardUnitId}-${w.validFrom}`} className={w.open ? "" : "strike"}>
              <td className="mono">{w.wardUnitId}</td>
              <td>{w.wardName}</td>
              <td>{w.stake}</td>
              <td className="mono">{w.validFrom}</td>
              <td className="mono">{w.validTo ?? "–"}</td>
              <td>
                {w.open && (
                  <button className="btn" disabled={busy} onClick={() => run(() => api.closeWard(area.key, w.wardUnitId, w.validFrom, vf))}>
                    Stop covering at {vf}
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
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="inline-form">
      <input placeholder="IMOS area id" value={id} onChange={(e) => setId(e.target.value)} style={{ width: 150 }} />
      <button
        className="btn"
        disabled={busy || !/^\d+$/.test(id.trim())}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          try {
            await api.attachArea(Number(id), areaKey, vf);
            setId("");
            onDone();
          } catch (e) {
            setMsg((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Attach id to this area from {vf}
      </button>
      {msg && <span className="muted" style={{ fontSize: ".8rem", color: "var(--band-lo)" }}>{msg}</span>}
    </div>
  );
}

function AddWard({ areaKey, vf, onDone }: { areaKey: string; vf: string; onDone: () => void }) {
  const [f, setF] = useState({ wardUnitId: "", wardName: "", stake: "" });
  const [busy, setBusy] = useState(false);
  const ok = /^\d+$/.test(f.wardUnitId.trim()) && f.wardName.trim() && f.stake.trim();
  return (
    <div className="inline-form">
      <input placeholder="org id" value={f.wardUnitId} onChange={(e) => setF({ ...f, wardUnitId: e.target.value })} style={{ width: 110 }} />
      <input placeholder="unit name" value={f.wardName} onChange={(e) => setF({ ...f, wardName: e.target.value })} />
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
              wardName: f.wardName.trim(),
              stake: f.stake.trim(),
              validFrom: vf,
            });
            setF({ wardUnitId: "", wardName: "", stake: "" });
            onDone();
          } finally {
            setBusy(false);
          }
        }}
      >
        Add a unit this area covers from {vf}
      </button>
    </div>
  );
}
