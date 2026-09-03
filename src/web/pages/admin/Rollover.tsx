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
  const [goneSel, setGoneSel] = useState<Set<number>>(new Set());
  const [zoneMsg, setZoneMsg] = useState<string | null>(null);
  // the actual transfer day, usually the Thursday of the week; recorded, not used for dating
  const [transferDate, setTransferDate] = useState(() => {
    const thu = new Date(Date.parse(`${week}T00:00:00Z`) + 3 * 86_400_000);
    return thu.toISOString().slice(0, 10);
  });
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

  const canApply = areaSel.size + wardSel.size + goneSel.size > 0;

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
        retire: plan.vanished
          .filter((v) => goneSel.has(v.imosAreaId))
          .map((v) => ({ imosAreaId: v.imosAreaId, canonicalAreaKey: v.canonicalAreaKey, validFrom: v.validFrom })),
        transferDate: transferDate || undefined,
      };
      const res = await api.applyRollover(week, body);
      setMsg(
        `Applied ${res.applied.areas} area mapping(s), ${res.applied.wards} unit row(s), ` +
          `closed ${res.applied.closed} mapping(s), retired ${res.applied.retired} area(s).` +
          (res.applied.skipped?.length ? ` Skipped: ${res.applied.skipped.join("; ")}.` : ""),
      );
      setAreaSel(new Set());
      setWardSel(new Set());
      setGoneSel(new Set());
      setAreaOv({});
      setWardOv({});
      reload();
    } catch (e) {
      setMsg(`Apply failed: ${String((e as Error).message)}`);
    } finally {
      setBusy(false);
    }
  }

  async function applyZoneOrder() {
    if (!plan.zoneOrderSuggested) return;
    setBusy(true);
    setZoneMsg(null);
    try {
      await api.setConfig("zone_order", plan.zoneOrderSuggested);
      setZoneMsg("Zone order updated.");
      reload();
    } catch (e) {
      setZoneMsg(`Failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const summaryCards = useMemo(
    () => [
      ["Areas to map", plan.summary.areasUnmapped],
      ["…new this transfer", plan.summary.areasNew],
      ["Areas gone", plan.summary.areasVanished],
      ["Units to map", plan.summary.wardsUnmapped],
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

      {(plan.newLeadershipPositions?.length ?? 0) > 0 && (
        <div className="note warn">
          <strong>New leadership-looking position{plan.newLeadershipPositions!.length === 1 ? "" : "s"} in IMOS:</strong>{" "}
          <span className="mono">{plan.newLeadershipPositions!.join(", ")}</span>. Not in the MLC list, so
          areas holding {plan.newLeadershipPositions!.length === 1 ? "it" : "them"} are not counted as MLC
          areas. If {plan.newLeadershipPositions!.length === 1 ? "it is" : "they are"} a zone leader / STL / assistant
          role under a new name, add {plan.newLeadershipPositions!.length === 1 ? "it" : "them"} in{" "}
          <Link to="/admin/config">Reporting settings → MLC positions</Link>.
        </div>
      )}
      {(plan.newPositions?.length ?? 0) > 0 && (plan.newLeadershipPositions?.length ?? 0) === 0 && (
        <p className="muted" style={{ fontSize: ".82rem" }}>
          New position string{plan.newPositions!.length === 1 ? "" : "s"} first seen this week:{" "}
          <span className="mono">{plan.newPositions!.join(", ")}</span> (not leadership-looking; nothing to do).
        </p>
      )}

      {/* zones */}
      {(plan.zones.some((z) => z.status !== "unchanged") ||
        plan.zoneOrderSuggested ||
        plan.excludedZonesMissing.length > 0) && (
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
          {plan.excludedZonesMissing.length > 0 && (
            <div className="note warn" style={{ marginTop: ".6rem" }}>
              The zone{plan.excludedZonesMissing.length === 1 ? "" : "s"} excluded from mission totals (
              {plan.excludedZonesMissing.join(", ")}) {plan.excludedZonesMissing.length === 1 ? "is" : "are"} not
              in this week's report. If it was renamed, the exclusion no longer applies: update it in{" "}
              <Link to="/admin/config">Reporting settings</Link>.
            </div>
          )}
          {plan.zoneOrderSuggested && (
            <div className="note" style={{ marginTop: ".6rem" }}>
              Zone order on the boards is out of date for this week. Suggested:{" "}
              <span className="mono" style={{ fontSize: ".8rem" }}>{plan.zoneOrderSuggested.join(" · ")}</span>{" "}
              <button className="btn" disabled={busy} onClick={applyZoneOrder}>Use this order</button>
              {zoneMsg && <span className="muted" style={{ marginLeft: ".5rem", fontSize: ".82rem" }}>{zoneMsg}</span>}
            </div>
          )}
        </>
      )}

      {/* vanished areas */}
      {plan.vanished.length > 0 && (
        <>
          <div className="row" style={{ justifyContent: "space-between", marginTop: "1.6rem" }}>
            <h4 style={{ margin: 0 }}>Areas gone from IMOS this week ({plan.vanished.length})</h4>
            <span className="row">
              <button className="btn" onClick={() => setGoneSel(new Set(plan.vanished.map((v) => v.imosAreaId)))}>
                Select all
              </button>
              <button className="btn" onClick={() => setGoneSel(new Set())}>Clear</button>
            </span>
          </div>
          <p className="muted" style={{ fontSize: ".85rem", maxWidth: "74ch" }}>
            These IMOS ids are mapped but no longer appear in the report. Closing the mapping dates the
            end of that id at {week}; when it was the area's only id the area is retired (its history
            stays; un-retire in Areas &amp; units if it comes back). Leave one unticked if the area is
            only paused for a transfer.
          </p>
          <div className="tbl-scroll">
            <table className="grid">
              <thead>
                <tr>
                  <th style={{ width: "2rem" }}></th>
                  <th>Area</th>
                  <th>IMOS id</th>
                  <th>Mapped since</th>
                  <th>Effect</th>
                </tr>
              </thead>
              <tbody>
                {plan.vanished.map((v) => (
                  <tr key={v.imosAreaId}>
                    <td>
                      <input
                        type="checkbox"
                        checked={goneSel.has(v.imosAreaId)}
                        onChange={(e) =>
                          setGoneSel((s) => {
                            const n = new Set(s);
                            e.target.checked ? n.add(v.imosAreaId) : n.delete(v.imosAreaId);
                            return n;
                          })
                        }
                      />
                    </td>
                    <td>
                      {v.displayName}
                      <div className="muted mono" style={{ fontSize: ".72rem" }}>{v.canonicalAreaKey}</div>
                    </td>
                    <td className="mono">#{v.imosAreaId}</td>
                    <td className="mono">{v.validFrom}</td>
                    <td style={{ textAlign: "left" }}>
                      {v.wouldRetire ? (
                        <span className="chip low">close + retire area</span>
                      ) : v.otherOpenMappings > 0 ? (
                        <span className="chip">close this id only ({v.otherOpenMappings} other id{v.otherOpenMappings === 1 ? "" : "s"} stay open)</span>
                      ) : (
                        <span className="chip high">close this id; its successor is in “Areas to map”</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
            <h4 style={{ margin: 0 }}>Units to map ({plan.wards.length})</h4>
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
                  <th>Org (unit)</th>
                  <th>Area</th>
                  <th>Canonical key</th>
                  <th>Unit name</th>
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

      {(unmappedAreas.length > 0 || plan.wards.length > 0 || plan.vanished.length > 0) && (
        <div className="row" style={{ marginTop: "1.2rem" }}>
          <button className="btn primary" disabled={!canApply || busy} onClick={apply}>
            {busy
              ? "Applying…"
              : `Apply ${areaSel.size} area${areaSel.size === 1 ? "" : "s"} + ${wardSel.size} unit${wardSel.size === 1 ? "" : "s"}` +
                (goneSel.size ? ` + close ${goneSel.size} gone` : "") +
                ` effective ${week}`}
          </button>
          <label className="row" style={{ gap: ".4rem", fontSize: ".8rem" }}>
            <span className="muted">Transfer day</span>
            <input type="date" value={transferDate} onChange={(e) => setTransferDate(e.target.value)} style={{ fontSize: ".8rem" }} />
          </label>
        </div>
      )}
      {(unmappedAreas.length > 0 || plan.wards.length > 0 || plan.vanished.length > 0) && (
        <p className="muted" style={{ fontSize: ".8rem", maxWidth: "80ch" }}>
          Mappings are dated by reporting week, so everything above takes effect from Monday {week}
          and earlier weeks keep their old mapping. The transfer day is written into the record for
          anyone reading the history later; it does not change any number, because numbers are only
          ever stored per week.
        </p>
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
