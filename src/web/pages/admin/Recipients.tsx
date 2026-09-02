import { useEffect, useState } from "react";
import { api, type StakeRecipient } from "../../api.js";
import { ErrorNote, Loading, useAsync } from "../../lib.js";

export function RecipientsPage() {
  const { data, err, loading, reload } = useAsync(() => api.recipients(), []);
  const [rows, setRows] = useState<StakeRecipient[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (data) setRows(data.recipients);
  }, [data]);

  if (loading) return <Loading what="recipients" />;
  if (err) return <ErrorNote err={err} />;

  const patch = (i: number, k: keyof StakeRecipient, v: string) =>
    setRows((r) => r.map((row, j) => (j === i ? { ...row, [k]: v } : row)));

  const save = async (r: StakeRecipient) => {
    setBusy(r.stake);
    try {
      await api.setRecipient(r);
      setMsg(`saved ${r.stake}`);
      setTimeout(() => setMsg(null), 2000);
      reload();
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <h3 style={{ margin: 0 }}>Stake-report recipients</h3>
      <p className="muted" style={{ fontSize: ".85rem", maxWidth: "70ch" }}>
        Used by the Publish page's "Open in Gmail" link. Comma-separate multiple addresses. The CC
        column also picks up the mission-wide CC list from Config.
      </p>

      {rows.length === 0 && (
        <div className="note">
          Nothing here yet.{" "}
          <button
            className="btn"
            onClick={async () => {
              setBusy("__seed");
              try {
                const r = await api.seedRecipients();
                setMsg(`seeded ${r.seeded} stakes`);
                reload();
              } finally {
                setBusy(null);
              }
            }}
          >
            {busy === "__seed" ? "Seeding…" : "Seed from the old EMAILS sheet"}
          </button>
        </div>
      )}

      {msg && <div className="note">{msg}</div>}

      {rows.map((r, i) => (
        <div className="drawer" key={r.stake}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>{r.stake}</strong>
            <button className="btn" disabled={busy === r.stake} onClick={() => save(r)}>
              {busy === r.stake ? "Saving…" : "Save"}
            </button>
          </div>
          <div className="field">
            <label>Stake president</label>
            <input value={r.presidentName ?? ""} onChange={(e) => patch(i, "presidentName", e.target.value)} />
          </div>
          <div className="field">
            <label>To</label>
            <input value={r.toEmails ?? ""} onChange={(e) => patch(i, "toEmails", e.target.value)} />
          </div>
          <div className="field">
            <label>CC</label>
            <input value={r.ccEmails ?? ""} onChange={(e) => patch(i, "ccEmails", e.target.value)} />
          </div>
        </div>
      ))}
    </>
  );
}
