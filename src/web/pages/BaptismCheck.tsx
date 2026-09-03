import { useState } from "react";
import { api } from "../api.js";
import { ErrorNote, Loading, PageHead, useAsync, useWeek } from "../lib.js";
import { todayIso } from "@shared/dates";
import { BaptismsSubnav, MONTHS, fmtDate } from "./Friends.js";

/**
 * Monthly baptism check: every baptism the Mission Portal counted should have
 * a name on our list before the month's report goes out, plus the people who
 * left the sheet near their date without being marked baptized.
 */
export function BaptismCheckPage() {
  const { week } = useWeek();
  const defaultMonth = (week ?? todayIso()).slice(0, 7);
  const [month, setMonth] = useState(defaultMonth);
  const [nonce, setNonce] = useState(0);
  const { data, err, loading } = useAsync(() => api.reconcile(month), [month, nonce]);
  const refresh = () => setNonce((n) => n + 1);

  const monthLabel = (m: string) => {
    const [y, mm] = m.split("-").map((n) => parseInt(n, 10));
    return `${MONTHS[mm! - 1]} ${y}`;
  };

  return (
    <>
      <PageHead title="Baptisms" />
      <BaptismsSubnav>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />
      </BaptismsSubnav>

      <p className="muted" style={{ maxWidth: "74ch", fontSize: ".88rem" }}>
        Every baptism the Mission Portal counted should have a name on the list before the monthly
        report goes out. Missing names are confirmed with the STLs or recorded below.
      </p>

      {loading && <Loading what="the check" />}
      {err && <ErrorNote err={err} />}
      {data && (() => {
        const unmapped = data.byStake.find((r) => r.stake === "(unmapped)");
        const stakes = data.byStake
          .filter((r) => r.stake !== "(unmapped)")
          .map((r) => ({ ...r, missing: Math.max(0, r.kiFeedBC - r.namedCount) }));
        const missionMissing = Math.max(0, data.mission.kiFeedBC - data.mission.namedCount);
        const stakesToChase = stakes.filter((r) => r.missing > 0);
        const stakesOk = stakes.filter((r) => r.missing === 0 && (r.kiFeedBC > 0 || r.namedCount > 0));

        return (
          <>
            {missionMissing === 0 ? (
              <div className="note ok">
                <strong>Everything the Mission Portal counted for {monthLabel(data.month)} has a name.</strong>{" "}
                {data.mission.namedCount > data.mission.kiFeedBC
                  ? `The list has ${data.mission.namedCount - data.mission.kiFeedBC} more than the Portal, which is normal.`
                  : "Nothing to follow up."}
              </div>
            ) : (
              <div className="note warn">
                <strong>
                  {missionMissing} baptism{missionMissing === 1 ? "" : "s"} the Mission Portal counted
                  {missionMissing === 1 ? " is" : " are"} not on the list.
                </strong>{" "}
                Confirm the name{missionMissing === 1 ? "" : "s"} with the STLs and record {missionMissing === 1 ? "it" : "them"} below.
              </div>
            )}

            <div className="cards">
              <div className="card">
                <div className="k">On our list</div>
                <div className="v">{data.mission.namedCount}</div>
                <div className="sub">names for {monthLabel(data.month)}</div>
              </div>
              <div className="card">
                <div className="k">Mission Portal</div>
                <div className="v">{data.mission.kiFeedBC}</div>
                <div className="sub">their aggregate count</div>
              </div>
              <div className="card">
                <div className="k">Names to find</div>
                <div className="v" style={{ color: missionMissing === 0 ? "var(--band-hi)" : "var(--band-mid)" }}>
                  {missionMissing}
                </div>
                <div className="sub">{missionMissing === 0 ? "all accounted for" : "on the Portal, not our list"}</div>
              </div>
              {data.mission.unverifiedCount > 0 && (
                <div className="card">
                  <div className="k">Old unverified names</div>
                  <div className="v">{data.mission.unverifiedCount}</div>
                  <div className="sub">not counted, need a source</div>
                </div>
              )}
            </div>

            {unmapped && unmapped.kiFeedBC > 0 && (
              <div className="note">
                {unmapped.kiFeedBC} of the Mission Portal’s baptisms this month are in areas not yet
                mapped to a stake, so the per-stake breakdown below is incomplete. Map those areas in{" "}
                <strong>Admin → Rollover</strong>.
              </div>
            )}

            {stakesToChase.length > 0 ? (
              <>
                <h4 style={{ marginTop: "1.4rem", fontWeight: 600 }}>Stakes with names to find</h4>
                <div className="board-wrap">
                  <table className="board">
                    <thead>
                      <tr>
                        <th className="row-head">Stake</th>
                        <th>On our list</th>
                        <th>Mission Portal</th>
                        <th>Names to find</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stakesToChase.map((r) => (
                        <tr key={r.stake}>
                          <td className="row-head">{r.stake}</td>
                          <td>{r.namedCount}</td>
                          <td>{r.kiFeedBC}</td>
                          <td><span className="pct mid">{r.missing}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              stakes.length > 0 && (
                <div className="note ok" style={{ marginTop: "1rem" }}>
                  Every stake’s named list covers what the Mission Portal counted.
                </div>
              )
            )}
            {stakesOk.length > 0 && stakesToChase.length > 0 && (
              <p className="muted" style={{ fontSize: ".82rem" }}>
                {stakesOk.length} other stake{stakesOk.length === 1 ? "" : "s"} fully accounted for.
              </p>
            )}

            <RecordBaptism onRecorded={refresh} />

            <h4 style={{ marginTop: "1.8rem", fontWeight: 600 }}>
              Removed from the sheet near their date ({data.disappeared.length})
            </h4>
            {data.disappeared.length === 0 ? (
              <div className="note ok">
                No one dropped off the Baptisms (MLC) sheet near a past baptism date without being
                marked baptized.
              </div>
            ) : (
              <>
                <div className="note warn">
                  These friends passed their baptism date and then left the sheet without being
                  marked baptized. Confirm each with the STL.
                </div>
                <div className="board-wrap">
                  <table className="board">
                    <thead>
                      <tr>
                        <th className="row-head">Name</th>
                        <th className="row-head">Unit · Stake</th>
                        <th className="row-head">Was dated</th>
                        <th className="row-head">Last seen</th>
                        <th className="row-head">Missionaries</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.disappeared.map((d) => (
                        <tr key={d.id}>
                          <td className="row-head">{d.name}</td>
                          <td className="row-head muted">{[d.ward, d.stake].filter(Boolean).join(" · ")}</td>
                          <td className="row-head mono">{fmtDate(d.baptismDate)}</td>
                          <td className="row-head mono muted">{d.leftAt.slice(0, 10)}</td>
                          <td className="row-head muted" style={{ fontSize: ".82rem" }}>{d.missionaries ?? "–"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        );
      })()}
    </>
  );
}

function RecordBaptism({ onRecorded }: { onRecorded: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    name: "", baptismDate: "", ward: "", stake: "", missionaries: "", notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }));

  const submit = async () => {
    if (!f.name.trim() || !f.baptismDate) {
      setMsg("Name and baptism date are required.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.recordBaptism({
        name: f.name.trim(),
        baptismDate: f.baptismDate,
        ward: f.ward.trim() || undefined,
        stake: f.stake.trim() || undefined,
        missionaries: f.missionaries.trim() || undefined,
        notes: f.notes.trim() || undefined,
      });
      setMsg(r.duplicate ? "Already on record; nothing added." : "Recorded. Gap updated.");
      setF({ name: "", baptismDate: "", ward: "", stake: "", missionaries: "", notes: "" });
      onRecorded();
    } catch (e) {
      setMsg(`Failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div style={{ marginTop: "1rem" }}>
        <button className="btn" onClick={() => setOpen(true)}>
          + Record a baptism the sheet is missing
        </button>
      </div>
    );
  }

  return (
    <div className="drawer" style={{ marginTop: "1rem" }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>Record a completed baptism</strong>
        <button className="btn" onClick={() => setOpen(false)}>Close</button>
      </div>
      <p className="muted" style={{ fontSize: ".82rem", maxWidth: "68ch" }}>
        For a baptism that took place but is not on the Baptisms (MLC) sheet. The record counts
        toward the named total. If the STL later adds it to the sheet, remove this entry to avoid a
        double count.
      </p>
      <div className="inline-form">
        <label className="field"><span className="k mono">Name *</span>
          <input value={f.name} onChange={set("name")} /></label>
        <label className="field"><span className="k mono">Baptism date *</span>
          <input type="date" value={f.baptismDate} onChange={set("baptismDate")} /></label>
        <label className="field"><span className="k mono">Unit</span>
          <input value={f.ward} onChange={set("ward")} /></label>
        <label className="field"><span className="k mono">Stake</span>
          <input value={f.stake} onChange={set("stake")} /></label>
        <label className="field"><span className="k mono">Missionaries</span>
          <input value={f.missionaries} onChange={set("missionaries")} /></label>
        <label className="field"><span className="k mono">Note</span>
          <input value={f.notes} onChange={set("notes")} placeholder="why it's being added by hand" /></label>
      </div>
      <div className="row" style={{ marginTop: ".6rem" }}>
        <button className="btn primary" disabled={busy} onClick={submit}>
          {busy ? "Saving…" : "Record baptism"}
        </button>
        {msg && <span className="muted" style={{ fontSize: ".85rem" }}>{msg}</span>}
      </div>
    </div>
  );
}
