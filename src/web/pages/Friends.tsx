import { useMemo, useState } from "react";
import { NavLink, useSearchParams } from "react-router-dom";
import { api, type FriendRow } from "../api.js";
import { ErrorNote, Loading, PageHead, useAsync, useWeek } from "../lib.js";
import { todayIso } from "@shared/dates";

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const fmtShort = (iso: string) => {
  const [, m, d] = iso.split("-").map((n) => parseInt(n, 10));
  return `${MONTHS[m! - 1]!.slice(0, 3)} ${d}`;
};

export function fmtDate(iso: string | null): string {
  if (!iso) return "–";
  const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
  if (!y || !m || !d) return iso;
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1];
  return `${mon} ${d}, ${y}`;
}

/** The two halves of Baptisms: the live list, and the monthly check. Page
 *  controls (filters, month picker) sit on the right of the same row. */
export function BaptismsSubnav({ children }: { children?: React.ReactNode }) {
  return (
    <div
      className="row"
      style={{
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        borderBottom: "1px solid var(--rule)",
        paddingBottom: ".5rem",
        marginBottom: ".9rem",
      }}
    >
      <nav className="subnav" style={{ margin: 0, border: "none", padding: 0 }}>
        <NavLink to="/baptisms" end className={({ isActive }) => (isActive ? "active" : "")}>
          Friends &amp; baptisms
        </NavLink>
        <NavLink to="/baptisms/check" className={({ isActive }) => (isActive ? "active" : "")}>
          Monthly check
        </NavLink>
      </nav>
      {children && <span className="row" style={{ gap: ".6rem", alignItems: "center" }}>{children}</span>}
    </div>
  );
}

export function FriendsPage() {
  const { zones: dataZones } = useWeek();
  const [params, setParams] = useSearchParams();
  const zone = params.get("zone") ?? "";
  const status = (params.get("show") as "on-date" | "baptized" | "all" | null) ?? "on-date";
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const summary = useAsync(() => api.friendsSummary(), []);
  const list = useAsync(
    () => api.friends({ zone: zone || undefined, status }),
    [zone, status],
  );
  const refresh = () => {
    list.reload();
    summary.reload();
  };

  // The zone filter offers the zones in stored KI data plus any zone name the
  // sheet uses that the data doesn't (a tab named for a zone that has since
  // been renamed still needs to be selectable).
  const ZONES = useMemo(() => {
    const fromSheet = (list.data?.friends ?? []).map((f) => f.zone).filter((z): z is string => !!z);
    return [...dataZones, ...fromSheet.filter((z) => !dataZones.includes(z)).sort()].filter(
      (z, i, a) => a.indexOf(z) === i,
    );
  }, [dataZones, list.data]);

  const today = todayIso();
  const overdue =
    status === "on-date" && list.data
      ? list.data.friends.filter((f) => f.baptismDate && f.baptismDate < today)
      : [];

  return (
    <>
      <PageHead title="Baptisms" />
      <BaptismsSubnav>
        <span className="seg">
          {(["on-date", "baptized", "all"] as const).map((s) => (
            <button key={s} className={status === s ? "on" : ""} onClick={() => setParam("show", s === "on-date" ? "" : s)}>
              {s === "on-date" ? "On date" : s === "baptized" ? "Baptized" : "All"}
            </button>
          ))}
        </span>
        <select value={zone} onChange={(e) => setParam("zone", e.target.value)} aria-label="Zone">
          <option value="">All zones</option>
          {ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
      </BaptismsSubnav>

      {summary.data && (
        <div className="note">
          {summary.data.lastSyncedAt ? (
            <>
              Mirrored from the <strong>Baptisms (MLC)</strong> sheet, last synced{" "}
              {new Date(summary.data.lastSyncedAt).toLocaleString()}. Edit in the sheet.
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
                    <th className="row-head">Unit · Zone</th>
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

      {list.loading && <Loading what="friends" />}
      {list.err && <ErrorNote err={list.err} />}
      {list.data && status === "baptized" && <BaptizedSections rows={list.data.friends} onChange={refresh} />}
      {list.data && status !== "baptized" && <FriendTable rows={list.data.friends} onChange={refresh} />}
    </>
  );
}

/**
 * The "Baptized" list mixes three very different kinds of record, and
 * flattening them into one table is what made the page feel wrong: it put a
 * year of pre-portal backfill ahead of what's actually on the Baptisms (MLC)
 * sheet right now. Split by what each record actually is instead.
 */
const isCurrentSource = (source: string) => source === "sheet" || source === "portal";

function BaptizedSections({ rows, onChange }: { rows: FriendRow[]; onChange: () => void }) {
  const current = rows.filter((f) => isCurrentSource(f.source));
  const onSheetNow = current.filter((f) => f.leftSheetAt == null);
  const recentlyCleared = current
    .filter((f) => f.leftSheetAt != null)
    .sort((a, b) => (b.leftSheetAt ?? "").localeCompare(a.leftSheetAt ?? ""));
  const historical = rows.filter((f) => !isCurrentSource(f.source));

  return (
    <>
      <h4 style={{ marginTop: "1.2rem", fontWeight: 600 }}>
        Currently on the Baptisms (MLC) sheet ({onSheetNow.length})
      </h4>
      <FriendTable rows={onSheetNow} onChange={onChange} />

      {recentlyCleared.length > 0 && (
        <>
          <h4 style={{ marginTop: "1.8rem", fontWeight: 600 }}>
            Recently cleared from the sheet ({recentlyCleared.length})
          </h4>
          <p className="muted" style={{ fontSize: ".85rem", maxWidth: "74ch" }}>
            Confirmed, then removed from the sheet, usually in the routine STL clear-out. Use{" "}
            <em>doesn’t count</em> on any name that should not have counted.
          </p>
          <FriendTable rows={recentlyCleared} onChange={onChange} />
        </>
      )}

      {historical.length > 0 && (
        <details style={{ marginTop: "1.8rem" }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>
            Historical baptisms, before the sheet ({historical.length})
          </summary>
          <p className="muted" style={{ fontSize: ".85rem", maxWidth: "74ch", marginTop: ".5rem" }}>
            Reconstructed from older records when the portal launched. They predate the sheet and
            will not appear on it.
          </p>
          <FriendTable rows={historical} onChange={onChange} />
        </details>
      )}
    </>
  );
}

function FriendTable({ rows, onChange }: { rows: FriendRow[]; onChange: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  // any sheet column the portal has no named field for becomes a column here
  const extraKeys = useMemo(
    () => [...new Set(rows.flatMap((f) => Object.keys(f.extra ?? {})))].sort().slice(0, 8),
    [rows],
  );
  if (rows.length === 0) return <p className="muted">No records.</p>;

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Remove the hand-entered baptism record for ${name}?`)) return;
    setBusy(id);
    try {
      await api.deleteRecord(id);
      onChange();
    } finally {
      setBusy(null);
    }
  };

  const correct = async (id: string, name: string) => {
    const reason = window.prompt(
      `Why doesn't ${name}'s baptism count? (didn't happen, duplicate, not a convert baptism, etc.) ` +
        `This un-marks it everywhere: reports, the monthly check, Trends. The record stays, with your note.`,
    );
    if (reason == null) return; // cancelled
    if (!reason.trim()) {
      window.alert("A reason is required.");
      return;
    }
    setBusy(id);
    try {
      await api.correctBaptism(id, reason);
      onChange();
    } catch (e) {
      window.alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="board-wrap" style={{ marginTop: ".8rem" }}>
      <table className="board">
        <thead>
          <tr>
            <th className="row-head">Name</th>
            <th className="row-head">Zone · Stake</th>
            <th className="row-head">Unit</th>
            <th className="row-head">Missionaries</th>
            <th className="row-head">Baptism</th>
            <th>Church 2×</th>
            <th>Calendar</th>
            {extraKeys.map((k) => <th key={k} className="row-head" title="from the sheet">{k}</th>)}
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
              {extraKeys.map((k) => (
                <td key={k} className="row-head muted" style={{ fontSize: ".82rem" }}>{f.extra?.[k] ?? ""}</td>
              ))}
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
                ) : f.missingSince ? (
                  <span
                    className="chip medium"
                    title="Not on the sheet at the last sync. Kept for two days in case the row is being moved between tabs; dropped after that."
                  >
                    off the sheet since {f.missingSince.slice(0, 10)}
                  </span>
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
                      disabled={busy === f.id}
                      onClick={() => remove(f.id, f.name)}
                      style={{ fontSize: ".72rem", padding: "2px 7px" }}
                    >
                      {busy === f.id ? "removing…" : "remove"}
                    </button>
                  </>
                )}
                {f.baptizedConfirmed && (
                  <>
                    {" "}
                    <button
                      className="btn"
                      disabled={busy === f.id}
                      title="This baptism shouldn't count (didn't happen, duplicate, not a convert baptism)"
                      onClick={() => correct(f.id, f.name)}
                      style={{ fontSize: ".72rem", padding: "2px 7px" }}
                    >
                      {busy === f.id ? "…" : "doesn’t count"}
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

function Stat({ k, v, sub }: { k: string; v: React.ReactNode; sub?: string }) {
  return (
    <div className="card">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}
