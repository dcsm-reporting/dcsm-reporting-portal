import { useState } from "react";
import { api, type NotReportedArea } from "../api.js";
import { ErrorNote, Loading, PageHead, useAsync, useWeek } from "../lib.js";

const REASONS = [
  "Contacted the companionship",
  "Known area issue",
  "Will follow up",
  "Area is closing / vacant",
  "Other",
];

export function ChasePage() {
  const { week } = useWeek();
  const { data, err, loading, reload } = useAsync(() => api.chase(week!), [week]);
  if (!week) return <p className="muted">No weeks imported yet.</p>;
  if (loading) return <Loading what="the not-reported list" />;
  if (err) return <ErrorNote err={err} />;
  if (!data) return null;

  return (
    <>
      <PageHead title={`Not reported: ${data.weekLabel}`} week />
      <p className="muted" style={{ maxWidth: "72ch" }}>
        Areas whose IMOS numbers were not touched during this reporting week (from each area’s{" "}
        <code>history[].modifiedDate</code>). Acknowledge one to stop it flagging; it clears on its
        own once the area reports.
      </p>

      {data.count === 0 ? (
        <div className="note ok">
          Nothing outstanding.
          {data.newCount + data.ackCount > 0 &&
            ` (${data.newCount} new this transfer, ${data.ackCount} acknowledged.)`}
        </div>
      ) : (
        <div className="note warn">
          <strong>{data.count} area{data.count === 1 ? "" : "s"}</strong> haven’t entered numbers for{" "}
          {data.weekStart} and haven’t been acknowledged.
        </div>
      )}

      {data.open.length > 0 && (
        <NotReportedTable rows={data.open} week={week} mode="open" onChange={reload} />
      )}

      {data.newThisTransfer.length > 0 && (
        <details open={data.open.length === 0}>
          <summary>New this transfer ({data.newThisTransfer.length})</summary>
          <div style={{ padding: "0 1rem 1rem" }}>
            <p className="muted" style={{ fontSize: ".85rem" }}>
              These areas are new this transfer, so there is no prior week to compare and a blank
              first week is expected, not a missed report.
            </p>
            <NotReportedTable rows={data.newThisTransfer} week={week} mode="new" onChange={reload} />
          </div>
        </details>
      )}

      {data.acknowledged.length > 0 && (
        <details>
          <summary>Acknowledged ({data.acknowledged.length})</summary>
          <div style={{ padding: "0 1rem 1rem" }}>
            <NotReportedTable rows={data.acknowledged} week={week} mode="acked" onChange={reload} />
          </div>
        </details>
      )}
    </>
  );
}

function NotReportedTable({
  rows,
  week,
  mode,
  onChange,
}: {
  rows: NotReportedArea[];
  week: string;
  mode: "open" | "new" | "acked";
  onChange: () => void;
}) {
  return (
    <div className="board-wrap" style={{ marginTop: ".6rem" }}>
      <table className="board">
        <thead>
          <tr>
            <th className="row-head">Zone</th>
            <th className="row-head">Area</th>
            <th className="row-head">Last touched</th>
            <th className="row-head">{mode === "acked" ? "Acknowledged" : "Action"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.imosAreaId}>
              <td className="row-head">{a.zoneName}</td>
              <td className="row-head">{a.areaName}</td>
              <td className="row-head mono">{a.lastModified ?? "never"}</td>
              <td className="row-head">
                <RowAction area={a} week={week} mode={mode} onChange={onChange} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RowAction({
  area,
  week,
  mode,
  onChange,
}: {
  area: NotReportedArea;
  week: string;
  mode: "open" | "new" | "acked";
  onChange: () => void;
}) {
  const [reason, setReason] = useState(REASONS[0]!);
  const [busy, setBusy] = useState(false);

  if (mode === "acked") {
    return (
      <span className="row" style={{ gap: ".5rem" }}>
        <span className="chip">{area.ackReason || "no reason given"}</span>
        <button
          className="btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api.unackNotReported(week, area.imosAreaId);
              onChange();
            } finally {
              setBusy(false);
            }
          }}
        >
          Undo
        </button>
      </span>
    );
  }

  return (
    <span className="row" style={{ gap: ".4rem" }}>
      <select value={reason} onChange={(e) => setReason(e.target.value)} style={{ fontSize: ".8rem" }}>
        {REASONS.map((r) => (
          <option key={r} value={r}>{r}</option>
        ))}
      </select>
      <button
        className="btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api.ackNotReported(week, area.imosAreaId, reason);
            onChange();
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "…" : "Acknowledge"}
      </button>
    </span>
  );
}
