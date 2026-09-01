import { useState } from "react";
import { api, type FriendRow } from "../api.js";
import { ErrorNote, Loading, useAsync, useWeek } from "../lib.js";

const ZONES = [
  "Alexandria", "Annandale", "Bull Run", "McLean", "Oakton",
  "Langley", "Loudoun", "Woodbridge", "Manassas", "Potomac",
];

export function FriendsPage() {
  const { week } = useWeek();
  const [zone, setZone] = useState("");
  const [status, setStatus] = useState<"on-date" | "baptized" | "all">("on-date");

  const summary = useAsync(() => api.friendsSummary(week ?? undefined), [week]);
  const list = useAsync(
    () => api.friends({ zone: zone || undefined, status }),
    [zone, status],
  );

  return (
    <>
      <h2>Friends &amp; on-date</h2>

      {summary.data && (
        <div className="note">
          {summary.data.lastSyncedAt ? (
            <>
              Mirrored from the <strong>Baptisms (MLC)</strong> sheet — last sync{" "}
              {new Date(summary.data.lastSyncedAt).toLocaleString()}. Edit in the sheet; this view is
              read-only.
            </>
          ) : (
            <>
              <strong>Not linked yet.</strong> Set up the sheet bridge (see{" "}
              <code>apps_script/baptisms-sync.gs</code>) — until then this is empty.
            </>
          )}
        </div>
      )}

      {summary.loading && <Loading what="the summary" />}
      {summary.err && <ErrorNote err={summary.err} />}
      {summary.data && (
        <div className="cards">
          <Stat k="On date" v={summary.data.onDateTotal} />
          <Stat k="On date this week" v={summary.data.onDateThisWeek} sub={week ?? ""} />
          <Stat k="Baptized this month" v={summary.data.baptizedThisMonth} />
          <Stat
            k="Baptismal calendar"
            v={`${summary.data.calendarYes} / ${summary.data.calendarYes + summary.data.calendarNo}`}
            sub="have it"
          />
          <Stat
            k="Church 2×"
            v={`${summary.data.church2xYes} / ${summary.data.church2xYes + summary.data.church2xNo}`}
            sub="attended"
          />
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
      {list.data && <FriendTable rows={list.data.friends} />}
    </>
  );
}

function FriendTable({ rows }: { rows: FriendRow[] }) {
  if (rows.length === 0) return <p className="muted">No records.</p>;
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
              <td className="row-head">{f.ward ?? "—"}</td>
              <td className="row-head muted" style={{ fontSize: ".82rem" }}>{f.missionaries ?? "—"}</td>
              <td className="row-head mono">
                {f.baptismDate ?? "—"}
                {f.baptismTime && f.baptismTime !== "TBD" ? ` · ${f.baptismTime}` : ""}
              </td>
              <td>{f.attendedChurch2x ? "✓" : ""}</td>
              <td>{f.onBaptismCalendar ? "✓" : ""}</td>
              <td className="row-head">
                {f.baptizedConfirmed ? (
                  <span className="chip high">baptized</span>
                ) : f.dropped ? (
                  <span className="chip low">dropped</span>
                ) : (
                  <span className="chip">on date</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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
