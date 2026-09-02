import { useEffect, useState } from "react";
import { api, type StakeRecipient } from "../../api.js";
import { ErrorNote, Loading, useAsync } from "../../lib.js";

export function RecipientsPage() {
  const { data, err, loading, reload } = useAsync(() => api.recipients(), []);
  const [rows, setRows] = useState<StakeRecipient[]>([]);
  const [cc, setCc] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (data) {
      setRows(data.recipients);
      setCc(data.ccAll.join(", "));
    }
  }, [data]);

  if (loading) return <Loading what="recipients" />;
  if (err) return <ErrorNote err={err} />;

  const patch = (i: number, k: "presidentName" | "toEmails", v: string) =>
    setRows((r) => r.map((row, j) => (j === i ? { ...row, [k]: v } : row)));

  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 2000);
  };

  const saveRow = async (r: StakeRecipient) => {
    setBusy(r.stake);
    try {
      await api.setRecipient({ stake: r.stake, presidentName: r.presidentName, toEmails: r.toEmails });
      flash(`saved ${r.stake}`);
      reload();
    } finally {
      setBusy(null);
    }
  };

  const saveCc = async () => {
    setBusy("__cc");
    try {
      const list = cc.split(/[,;\s]+/).map((s) => s.trim()).filter((s) => s.includes("@"));
      await api.setReportCc(list);
      flash("CC list saved");
      reload();
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <h3 style={{ margin: 0 }}>Stake-report recipients</h3>
      <p className="muted" style={{ fontSize: ".85rem", maxWidth: "70ch" }}>
        Used by the Publish page's "Open in Gmail" link. Comma-separate multiple addresses.
      </p>

      {msg && <div className="note">{msg}</div>}

      <div className="drawer">
        <strong>CC on every stake report</strong>
        <p className="muted" style={{ fontSize: ".82rem" }}>
          The same list is CC'd on all eleven reports (mission leadership, secretary, etc.).
        </p>
        <div className="field">
          <input
            value={cc}
            onChange={(e) => setCc(e.target.value)}
            placeholder="president@…, secretary@…"
          />
        </div>
        <button className="btn primary" disabled={busy === "__cc"} onClick={saveCc}>
          {busy === "__cc" ? "Saving…" : "Save CC list"}
        </button>
      </div>

      {rows.length === 0 && (
        <div className="note">
          No stakes yet.{" "}
          <button
            className="btn"
            onClick={async () => {
              setBusy("__seed");
              try {
                const r = await api.seedRecipients();
                flash(`seeded ${r.seeded} stakes`);
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

      {rows.map((r, i) => (
        <div className="drawer" key={r.stake}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>{r.stake}</strong>
            <button className="btn" disabled={busy === r.stake} onClick={() => saveRow(r)}>
              {busy === r.stake ? "Saving…" : "Save"}
            </button>
          </div>
          <div className="field">
            <label>Stake president (used in the letter greeting)</label>
            <input
              value={r.presidentName ?? ""}
              onChange={(e) => patch(i, "presidentName", e.target.value)}
            />
          </div>
          <div className="field">
            <label>To</label>
            <input value={r.toEmails ?? ""} onChange={(e) => patch(i, "toEmails", e.target.value)} />
          </div>
        </div>
      ))}
    </>
  );
}
