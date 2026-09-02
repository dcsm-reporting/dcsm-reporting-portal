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
      <h2>Friends with Baptismal Dates &amp; Baptized</h2>

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
          <Stat
            k="Baptized this month"
            v={summary.data.baptizedThisMonth}
            sub={
              summary.data.baptizedThisMonthUnverified > 0
                ? `+${summary.data.baptizedThisMonthUnverified} unverified`
                : ""
            }
          />
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

      <Reconciliation />
    </>
  );
}

function Reconciliation() {
  const { week } = useWeek();
  const defaultMonth = (week ?? new Date().toISOString().slice(0, 10)).slice(0, 7);
  const [month, setMonth] = useState(defaultMonth);
  const { data, err, loading } = useAsync(() => api.reconcile(month), [month]);

  return (
    <>
      <h3 style={{ marginTop: "2.4rem" }}>Monthly baptism reconciliation</h3>
      <p className="muted" style={{ maxWidth: "72ch", fontSize: ".88rem" }}>
        The named count is the authoritative total (per the SOP). This is the pre-report cross-check:
        where the named records and the Mission Portal / KI-feed aggregate disagree, and anyone who
        dropped off the sheet near their baptism date without being confirmed.
      </p>
      <div className="row">
        <label className="field" style={{ margin: 0 }}>
          <span className="k mono">Month</span>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </label>
      </div>

      {loading && <Loading what="reconciliation" />}
      {err && <ErrorNote err={err} />}
      {data && (
        <>
          <div className="cards">
            <div className="card">
              <div className="k">Named baptisms</div>
              <div className="v">{data.mission.namedCount}</div>
              <div className="sub">authoritative</div>
            </div>
            <div className="card">
              <div className="k">KI-feed aggregate</div>
              <div className="v">{data.mission.kiFeedBC}</div>
              <div className="sub">Mission Portal — flag only</div>
            </div>
            {data.mission.unverifiedCount > 0 && (
              <div className="card">
                <div className="k">Unverified (legacy)</div>
                <div className="v">{data.mission.unverifiedCount}</div>
                <div className="sub">ZL-form only, not counted</div>
              </div>
            )}
            <div className="card">
              <div className="k">Gap to close</div>
              <div className="v" style={{ color: data.mission.gap === 0 ? "var(--band-hi)" : "var(--band-mid)" }}>
                {data.mission.gap > 0 ? `+${data.mission.gap}` : data.mission.gap}
              </div>
              <div className="sub">{data.mission.gap > 0 ? "names likely missing" : data.mission.gap < 0 ? "ahead of Mission Portal" : "reconciled"}</div>
            </div>
          </div>

          {data.byStake.some((r) => r.gap !== 0) && (
            <div className="board-wrap">
              <table className="board">
                <thead>
                  <tr>
                    <th className="row-head">Stake</th>
                    <th>Named</th>
                    <th>KI-feed</th>
                    <th>Gap</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byStake
                    .filter((r) => r.gap !== 0)
                    .map((r) => (
                      <tr key={r.stake}>
                        <td className="row-head">{r.stake}</td>
                        <td>{r.namedCount}</td>
                        <td>{r.kiFeedBC}</td>
                        <td>
                          <span className={`pct ${r.gap === 0 ? "hi" : "mid"}`}>
                            {r.gap > 0 ? `+${r.gap}` : r.gap}
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          <h4 style={{ marginTop: "1.6rem", fontFamily: "IBM Plex Sans", fontWeight: 600 }}>
            Disappeared near their date ({data.disappeared.length})
          </h4>
          {data.disappeared.length === 0 ? (
            <div className="note ok">Nobody dropped off the sheet unconfirmed near a past baptism date.</div>
          ) : (
            <>
              <div className="note warn">
                These friends had a baptism date that has now passed and were removed from the sheet
                without being marked baptized. Verify each: if they were baptized, the STL re-adds
                them to the sheet.
              </div>
              <div className="board-wrap">
                <table className="board">
                  <thead>
                    <tr>
                      <th className="row-head">Name</th>
                      <th className="row-head">Ward · Stake</th>
                      <th className="row-head">Baptism date</th>
                      <th className="row-head">Left sheet</th>
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
                        <td className="row-head muted" style={{ fontSize: ".82rem" }}>{d.missionaries ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
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
                    <span className="chip high" title={f.confidence ? "legacy — corroborated" : ""}>
                      baptized
                    </span>
                  )
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

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
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
