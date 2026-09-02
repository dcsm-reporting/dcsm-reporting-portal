import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type RolloverPlan } from "../../api.js";
import { ErrorNote, Loading, useAsync, useWeek } from "../../lib.js";

type AreaOverride = { key: string; isNew: boolean; displayName: string };
type WardOverride = { canonicalAreaKey: string; wardName: string; stake: string };

export function RolloverPage() {
  const { week } = useWeek();
  const { data, err, loading, reload } = useAsync(
    () => (week ? api.rollover(week) : Promise.resolve(null)),
    [week],
  );

  if (!week) return <p className="muted">No weeks imported yet.</p>;
  if (loading) return <Loading what="the rollover plan" />;
  if (err) return <ErrorNote err={err} />;
  if (!data) return null;
  return <RolloverBody key={week} week={week} plan={data} reload={reload} />;
}

function RolloverBody({
  week,
  plan,
  reload,
}: {
  week: string;
  plan: RolloverPlan;
  reload: () => void;
}) {
  const unmappedAreas = plan.areas.filter((a) => !a.mapped);
  const neverSeeded = plan.areas.length > 0 && plan.areas.every((a) => !a.mapped);

  const [areaSel, setAreaSel] = useState<Set<number>>(new Set());
  const [wardSel, setWardSel] = useState<Set<number>>(new Set());
  const [areaOv, setAreaOv] = useState<Record<number, AreaOverride>>({});
  const [wardOv, setWardOv] = useState<Record<number, WardOverride>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const areaFor = (id: number): AreaOverride => {
    if (areaOv[id]) return areaOv[id]!;
    const s = unmappedAreas.find((a) => a.imosAreaId === id)?.suggestion;
    return { key: s?.canonicalAreaKey ?? "", isNew: s?.isNew ?? true, displayName: s?.displayName ?? "" };
  };
  const wardFor = (id: number): WardOverride => {
    if (wardOv[id]) return wardOv[id]!;
    const w = plan.wards.find((x) => x.orgId === id);
    return {
      canonicalAreaKey: w?.suggestion.canonicalAreaKey ?? "",
      wardName: w?.suggestion.wardName ?? "",
      stake: w?.suggestion.stake ?? "",
    };
  };

  const selectSuggestedAreas = () =>
    setAreaSel(
      new Set(unmappedAreas.filter((a) => a.suggestion && a.suggestion.confidence !== "low").map((a) => a.imosAreaId)),
    );
  const selectSuggestedWards = () =>
    setWardSel(new Set(plan.wards.filter((w) => w.suggestion.stake).map((w) => w.orgId)));

  const canApply = areaSel.size + wardSel.size > 0;

  async function apply() {
    setBusy(true);
    setMsg(null);
    try {
      const body = {
        validFrom: week,
        areas: [...areaSel].map((id) => {
          const o = areaFor(id);
          return { imosAreaId: id, canonicalAreaKey: o.key, isNew: o.isNew, displayName: o.displayName || o.key };
        }),
        wards: [...wardSel]
          .map((id) => {
            const o = wardFor(id);
            return { orgId: id, canonicalAreaKey: o.canonicalAreaKey, wardName: o.wardName, stake: o.stake };
          })
          .filter((w) => w.canonicalAreaKey && w.stake),
      };
      const res = await api.applyRollover(week, body);
      setMsg(`Applied ${res.applied.areas} area mapping(s) and ${res.applied.wards} ward row(s).`);
      setAreaSel(new Set());
      setWardSel(new Set());
      setAreaOv({});
      setWardOv({});
      reload();
    } catch (e) {
      setMsg(`Apply failed: ${String((e as Error).message)}`);
    } finally {
      setBusy(false);
    }
  }

  const summaryCards = useMemo(
    () => [
      ["Areas to map", plan.summary.areasUnmapped],
      ["…new this transfer", plan.summary.areasNew],
      ["Wards to map", plan.summary.wardsUnmapped],
      ["New / retired zones", `${plan.summary.zonesNew} / ${plan.summary.zonesRetired}`],
    ],
    [plan],
  );

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>Transfer rollover: {plan.weekStart}</h3>
        <button className="btn" onClick={reload}>Re-scan</button>
      </div>

      {plan.summary.clean ? (
        <div className="note ok">
          Structure matches this week. Nothing to do.{" "}
          <Link to={`/?w=${week}`}>Spot-check the board →</Link>
        </div>
      ) : (
        <div className="cards">
          {summaryCards.map(([k, v]) => (
            <div className="card" key={k}>
              <div className="k">{k}</div>
              <div className="v">{v}</div>
            </div>
          ))}
        </div>
      )}

      {neverSeeded && (
        <div className="note warn">
          <strong>No crosswalk for this structure yet.</strong> If this is the first run for a new
          transfer, seed it in one step:{" "}
          <SeedButton week={week} onDone={reload} />
          <br />
          Otherwise map the areas below.
        </div>
      )}

      {msg && <div className="note">{msg}</div>}

      {/* zones */}
      {plan.zones.some((z) => z.status !== "unchanged") && (
        <>
          <h4 style={{ marginTop: "1.6rem" }}>Zones</h4>
          <div className="row">
            {plan.zones.map((z) => (
              <span
                key={z.name}
                className={`chip ${z.status === "new" ? "new" : z.status === "retired" ? "low" : ""}`}
                title={`${z.areaCount} area(s)`}
              >
                {z.name} · {z.status}
              </span>
            ))}
          </div>
        </>
      )}

      {plan.summary.areasNew > 0 && (
        <div className="note">
          <strong>“new”</strong> marks an area that appears this week but wasn’t in last week’s
          payload, usually a transfer split (one area becoming two). Give it its own canonical key
          and map it; its history simply starts here. If it’s really the <em>same</em> area under a
          new IMOS id, set the key to the existing one instead and untick “New?”.
        </div>
      )}

      {/* areas */}
      {unmappedAreas.length > 0 && (
        <>
          <div className="row" style={{ justifyContent: "space-between", marginTop: "1.6rem" }}>
            <h4 style={{ margin: 0 }}>Areas to map ({unmappedAreas.length})</h4>
            <span className="row">
              <button className="btn" onClick={selectSuggestedAreas}>Select suggested</button>
              <button className="btn" onClick={() => setAreaSel(new Set())}>Clear</button>
            </span>
          </div>
          <div className="tbl-scroll">
            <table className="grid">
              <thead>
                <tr>
                  <th style={{ width: "2rem" }}></th>
                  <th>IMOS area</th>
                  <th>Zone</th>
                  <th>Canonical key</th>
                  <th>New?</th>
                  <th>Suggestion</th>
                </tr>
              </thead>
              <tbody>
                {unmappedAreas.map((a) => {
                  const o = areaFor(a.imosAreaId);
                  const on = areaSel.has(a.imosAreaId);
                  return (
                    <tr key={a.imosAreaId}>
                      <td>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={(e) =>
                            setAreaSel((s) => {
                              const n = new Set(s);
                              e.target.checked ? n.add(a.imosAreaId) : n.delete(a.imosAreaId);
                              return n;
                            })
                          }
                        />
                      </td>
                      <td>
                        {a.imosAreaName}{" "}
                        {a.newThisWeek && <span className="chip new">new</span>}
                        <div className="muted mono" style={{ fontSize: ".72rem" }}>#{a.imosAreaId}</div>
                      </td>
                      <td>{a.zoneName}</td>
                      <td>
                        <input
                          value={o.key}
                          onChange={(e) =>
                            setAreaOv((m) => ({ ...m, [a.imosAreaId]: { ...areaFor(a.imosAreaId), key: e.target.value } }))
                          }
                        />
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={o.isNew}
                          onChange={(e) =>
                            setAreaOv((m) => ({
                              ...m,
                              [a.imosAreaId]: { ...areaFor(a.imosAreaId), isNew: e.target.checked },
                            }))
                          }
                        />
                      </td>
                      <td style={{ textAlign: "left" }}>
                        {a.suggestion && (
                          <>
                            <span className={`chip ${a.suggestion.confidence}`}>{a.suggestion.confidence}</span>{" "}
                            <span className="muted" style={{ fontSize: ".78rem" }}>{a.suggestion.reason}</span>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* wards */}
      {plan.wards.length > 0 && (
        <>
          <div className="row" style={{ justifyContent: "space-between", marginTop: "1.6rem" }}>
            <h4 style={{ margin: 0 }}>Wards to map ({plan.wards.length})</h4>
            <span className="row">
              <button className="btn" onClick={selectSuggestedWards}>Select suggested</button>
              <button className="btn" onClick={() => setWardSel(new Set())}>Clear</button>
            </span>
          </div>
          <div className="tbl-scroll">
            <table className="grid">
              <thead>
                <tr>
                  <th style={{ width: "2rem" }}></th>
                  <th>Org (ward)</th>
                  <th>Area</th>
                  <th>Canonical key</th>
                  <th>Ward name</th>
                  <th>Stake</th>
                  <th>Suggestion</th>
                </tr>
              </thead>
              <tbody>
                {plan.wards.map((w) => {
                  const o = wardFor(w.orgId);
                  const on = wardSel.has(w.orgId);
                  const set = (patch: Partial<WardOverride>) =>
                    setWardOv((m) => ({ ...m, [w.orgId]: { ...wardFor(w.orgId), ...patch } }));
                  return (
                    <tr key={w.orgId}>
                      <td>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={(e) =>
                            setWardSel((s) => {
                              const n = new Set(s);
                              e.target.checked ? n.add(w.orgId) : n.delete(w.orgId);
                              return n;
                            })
                          }
                        />
                      </td>
                      <td>
                        {w.orgName}
                        <div className="muted mono" style={{ fontSize: ".72rem" }}>#{w.orgId}</div>
                      </td>
                      <td>{w.areaName}</td>
                      <td><input value={o.canonicalAreaKey} onChange={(e) => set({ canonicalAreaKey: e.target.value })} /></td>
                      <td><input value={o.wardName} onChange={(e) => set({ wardName: e.target.value })} /></td>
                      <td><input value={o.stake} onChange={(e) => set({ stake: e.target.value })} /></td>
                      <td style={{ textAlign: "left" }}>
                        <span className={`chip ${w.suggestion.confidence}`}>{w.suggestion.confidence}</span>{" "}
                        <span className="muted" style={{ fontSize: ".78rem" }}>{w.suggestion.reason}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {(unmappedAreas.length > 0 || plan.wards.length > 0) && (
        <div className="row" style={{ marginTop: "1.2rem" }}>
          <button className="btn primary" disabled={!canApply || busy} onClick={apply}>
            {busy ? "Applying…" : `Apply ${areaSel.size} area${areaSel.size === 1 ? "" : "s"} + ${wardSel.size} ward${wardSel.size === 1 ? "" : "s"} effective ${week}`}
          </button>
          <span className="muted" style={{ fontSize: ".8rem" }}>
            Effective-dated from {week}; earlier weeks keep their old mapping.
          </span>
        </div>
      )}
    </>
  );
}

function SeedButton({ week, onDone }: { week: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <>
      <button
        className="btn primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await api.seed(week);
            setMsg(`seeded ${r.counts.canonicalAreas} areas / ${r.counts.areaWard} ward rows${r.unresolved.length ? ` · ${r.unresolved.length} unresolved` : ""}`);
            onDone();
          } catch (e) {
            setMsg(`failed: ${String((e as Error).message)}`);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Seeding…" : `Seed crosswalk from ${week}`}
      </button>
      {msg && <span className="muted" style={{ fontSize: ".8rem", marginLeft: ".5rem" }}>{msg}</span>}
    </>
  );
}
