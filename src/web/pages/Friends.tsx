import { useState } from "react";
import { api, type FriendRow } from "../api.js";
import { ErrorNote, Loading, PageHead, useAsync, useWeek } from "../lib.js";

const ZONES = [
  "Alexandria", "Annandale", "Bull Run", "McLean", "Oakton",
  "Langley", "Loudoun", "Woodbridge", "Manassas", "Potomac",
];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const fmtShort = (iso: string) => {
  const [, m, d] = iso.split("-").map((n) => parseInt(n, 10));
  return `${MONTHS[m! - 1]!.slice(0, 3)} ${d}`;
};

export function FriendsPage() {
  const [zone, setZone] = useState("");
  const [status, setStatus] = useState<"on-date" | "baptized" | "all">("on-date");

  const summary = useAsync(() => api.friendsSummary(), []);
  const list = useAsync(
    () => api.friends({ zone: zone || undefined, status }),
    [zone, status],
  );
  const refresh = () => {
    list.reload();
    summary.reload();
  };

  const today = new Date().toISOString().slice(0, 10);
  const overdue =
    status === "on-date" && list.data
      ? list.data.friends.filter((f) => f.baptismDate && f.baptismDate < today)
      : [];

  return (
    <>
      <PageHead title="Baptisms" />

      {summary.data && (
        <div className="note">
          {summary.data.lastSyncedAt ? (
            <>
              Mirrored from the <strong>Baptisms (MLC)</strong> sheet. Last sync{" "}
              {new Date(summary.data.lastSyncedAt).toLocaleString()}. Edit in the sheet; this view is
              read-only.
            </>
          ) : (
            <>
              <strong>Not linked yet.</strong> Set up the sheet bridge (see{" "}
              <code>apps_script/baptisms-sync.gs</code>); until then this is empty.
            </>
          )}
        </div>
      )}

      {summary.loading && <Loading what="the summary" />}
      {summary.err && <ErrorNote err={summary.err} />}
      {summary.data && (
        <div className="cards">
          <Stat k="On date" v={summary.data.onDateTotal} sub="have a baptismal date" />
          <Stat
            k="On date this week"
            v={summary.data.onDateThisWeek}
            sub={`${fmtShort(summary.data.weekStart)} to ${fmtShort(summary.data.weekEnd)}`}
          />
          <Stat
            k="Baptized this month"
            v={summary.data.baptizedThisMonth}
            sub={
              summary.data.baptizedThisMonthUnverified > 0
                ? `${MONTHS[parseInt(summary.data.month.slice(5), 10) - 1]} · +${summary.data.baptizedThisMonthUnverified} unverified`
                : MONTHS[parseInt(summary.data.month.slice(5), 10) - 1]
            }
          />
          <Stat
            k="Baptismal calendar prepared"
            v={`${summary.data.calendarYes} of ${summary.data.calendarYes + summary.data.calendarNo}`}
            sub="of those on date"
          />
          <Stat
            k="Attended church 2×"
            v={`${summary.data.church2xYes} of ${summary.data.church2xYes + summary.data.church2xNo}`}
            sub="of those on date"
          />
        </div>
      )}

      {summary.data && summary.data.overdueCount > 0 && (
        <div className="note warn">
          <strong>
            {summary.data.overdueCount} baptism{summary.data.overdueCount === 1 ? "" : "s"} past{" "}
            {summary.data.overdueCount === 1 ? "its date" : "their date"} and not marked completed.
          </strong>{" "}
          On the Baptisms (MLC) sheet, mark each one baptized or move it to a new date.
          {overdue.length > 0 && (
            <div className="board-wrap" style={{ marginTop: ".6rem" }}>
              <table className="board">
                <thead>
                  <tr>
                    <th className="row-head">Name</th>
                    <th className="row-head">Ward · Zone</th>
                    <th className="row-head">Was dated</th>
                    <th className="row-head">Missionaries</th>
                  </tr>
                </thead>
                <tbody>
                  {overdue.map((f) => (
                    <tr key={f.id}>
                      <td className="row-head">{f.name}</td>
                      <td className="row-head muted">{[f.ward, f.zone].filter(Boolean).join(" · ")}</td>
                      <td className="row-head mono">{fmtDate(f.baptismDate)}</td>
                      <td className="row-head muted" style={{ fontSize: ".82rem" }}>{f.missionaries ?? "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="row" style={{ marginTop: "1rem" }}>
        <label className="field" style={{ margin: 0 }}>
          <span className="k mono">Zone</span>
          <select value={zone} onChange={(e) => setZone(e.target.value)}>
            <option value="">All zones</option>
            {ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </label>
        <label className="field" style={{ margin: 0 }}>
          <span className="k mono">Show</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="on-date">On date</option>
            <option value="baptized">Baptized</option>
            <option value="all">All</option>
          </select>
        </label>
      </div>

      {list.loading && <Loading what="friends" />}
      {list.err && <ErrorNote err={list.err} />}
      {list.data && <FriendTable rows={list.data.friends} onChange={refresh} />}

      <Reconciliation onChange={refresh} />
    </>
  );
}

function Reconciliation({ onChange }: { onChange: () => void }) {
  const { week } = useWeek();
  const defaultMonth = (week ?? new Date().toISOString().slice(0, 10)).slice(0, 7);
  const [month, setMonth] = useState(defaultMonth);
  const [nonce, setNonce] = useState(0);
  const { data, err, loading } = useAsync(() => api.reconcile(month), [month, nonce]);

  const monthLabel = (m: string) => {
    const [y, mm] = m.split("-").map((n) => parseInt(n, 10));
    return `${MONTHS[mm! - 1]} ${y}`;
  };

  return (
    <>
      <h3 style={{ marginTop: "2.4rem" }}>Monthly baptism check</h3>
      <p className="muted" style={{ maxWidth: "74ch", fontSize: ".88rem" }}>
        Before the month’s baptism report goes out, make sure every baptism the Mission Portal
        counted has a name on our list. If the Portal counted more than we have names for, those
        baptisms need to be tracked down with the STLs (or added here).
      </p>
      <div className="row">
        <label className="field" style={{ margin: 0 }}>
          <span className="k mono">Month</span>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </label>
      </div>

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
                  ? `Our list has ${data.mission.namedCount - data.mission.kiFeedBC} more than the Portal, which is normal — our list is the more complete one.`
                  : "Nothing to track down."}
              </div>
            ) : (
              <div className="note warn">
                <strong>
                  {missionMissing} baptism{missionMissing === 1 ? "" : "s"} the Mission Portal counted
                  {missionMissing === 1 ? " is" : " are"} not on our list yet.
                </strong>{" "}
                Get the name{missionMissing === 1 ? "" : "s"} from the STLs and add {missionMissing === 1 ? "it" : "them"} below.
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
                <div
                  className="v"
                  style={{ color: missionMissing === 0 ? "var(--band-hi)" : "var(--band-mid)" }}
                >
                  {missionMissing}
                </div>
                <div className="sub">{missionMissing === 0 ? "all accounted for" : "on the Portal, not our list"}</div>
              </div>
              {data.mission.unverifiedCount > 0 && (
                <div className="card">
                  <div className="k">Old unverified names</div>
                  <div className="v">{data.mission.unverifiedCount}</div>
                  <div className="sub">not counted — need a source</div>
                </div>
              )}
            </div>

            {unmapped && unmapped.kiFeedBC > 0 && (
              <div className="note">
                {unmapped.kiFeedBC} of the Mission Portal’s baptisms this month are in areas not yet
                mapped to a stake, so the per-stake breakdown below is incomplete. Map those areas in{" "}
                <strong>Structure → Rollover</strong>.
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

            <RecordBaptism
              onRecorded={() => {
                setNonce((n) => n + 1);
                onChange();
              }}
            />

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
                  These friends had a baptism date that has now passed, then disappeared from the
                  sheet without being marked baptized. Either the baptism happened and wasn’t
                  recorded, or the date slipped. Check each with the STL.
                </div>
                <div className="board-wrap">
                  <table className="board">
                    <thead>
                      <tr>
                        <th className="row-head">Name</th>
                        <th className="row-head">Ward · Stake</th>
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
      setMsg(r.duplicate ? "Already on record – nothing added." : "Recorded. Gap updated.");
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
        Use this only when a baptism truly happened but isn't on the Baptisms (MLC) sheet (STL
        deleted the row, late confirmation). It's saved as an authoritative portal record and counts
        toward the named total. If the STL later re-adds them to the sheet, remove this entry from
        the list below to avoid a double-count.
      </p>
      <div className="inline-form">
        <label className="field"><span className="k mono">Name *</span>
          <input value={f.name} onChange={set("name")} /></label>
        <label className="field"><span className="k mono">Baptism date *</span>
          <input type="date" value={f.baptismDate} onChange={set("baptismDate")} /></label>
        <label className="field"><span className="k mono">Ward</span>
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

function FriendTable({ rows, onChange }: { rows: FriendRow[]; onChange: () => void }) {
  const [removing, setRemoving] = useState<string | null>(null);
  if (rows.length === 0) return <p className="muted">No records.</p>;

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Remove the hand-entered baptism record for ${name}?`)) return;
    setRemoving(id);
    try {
      await api.deleteRecord(id);
      onChange();
    } finally {
      setRemoving(null);
    }
  };
  return (
    <div className="board-wrap" style={{ marginTop: ".8rem" }}>
      <table className="board">
        <thead>
          <tr>
            <th className="row-head">Name</th>
            <th className="row-head">Zone · Stake</th>
            <th className="row-head">Ward</th>
            <th className="row-head">Missionaries</th>
            <th className="row-head">Baptism</th>
            <th>Church 2×</th>
            <th>Calendar</th>
            <th className="row-head">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => (
            <tr key={f.id}>
              <td className="row-head">{f.name}</td>
              <td className="row-head muted">{[f.zone, f.stake].filter(Boolean).join(" · ")}</td>
              <td className="row-head">{f.ward ?? "–"}</td>
              <td className="row-head muted" style={{ fontSize: ".82rem" }}>{f.missionaries ?? "–"}</td>
              <td className="row-head mono">
                {fmtDate(f.baptismDate)}
                {f.baptismTime && f.baptismTime !== "TBD" && !/1899|GMT/.test(f.baptismTime)
                  ? ` · ${f.baptismTime}`
                  : ""}
              </td>
              <td>{f.attendedChurch2x ? "✓" : ""}</td>
              <td>{f.onBaptismCalendar ? "✓" : ""}</td>
              <td className="row-head">
                {f.baptizedConfirmed ? (
                  f.confidence === "unverified" ? (
                    <span className="chip medium" title={f.notes ?? ""}>baptized · unverified</span>
                  ) : (
                    <span className="chip high" title={f.confidence ? "legacy – corroborated" : ""}>
                      baptized
                    </span>
                  )
                ) : f.dropped ? (
                  <span className="chip low">dropped</span>
                ) : (
                  <span className="chip">on date</span>
                )}
                {f.source === "portal" && (
                  <>
                    {" "}
                    <span className="chip new" title={f.notes ?? "hand-entered in the portal"}>
                      portal
                    </span>{" "}
                    <button
                      className="btn"
                      disabled={removing === f.id}
                      onClick={() => remove(f.id, f.name)}
                      style={{ fontSize: ".72rem", padding: "2px 7px" }}
                    >
                      {removing === f.id ? "removing…" : "remove"}
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return "–";
  const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
  if (!y || !m || !d) return iso;
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1];
  return `${mon} ${d}, ${y}`;
}

function Stat({ k, v, sub }: { k: string; v: React.ReactNode; sub?: string }) {
  return (
    <div className="card">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}
