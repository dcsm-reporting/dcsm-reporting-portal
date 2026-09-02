import { useEffect, useState } from "react";
import { api } from "../../api.js";
import { ErrorNote, Loading, useAsync, useMe } from "../../lib.js";

/**
 * Who can open the Admin section and change mission structure/config. An empty
 * list means everyone who gets past Cloudflare Access is an admin (the default,
 * and what you want before the first setup). Adding addresses locks it to them;
 * everyone else keeps read-only access to the rest of the portal.
 */
export function AccessPage() {
  const me = useMe();
  const { data, err, loading, reload } = useAsync(() => api.admins(), []);
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (data) setVal(data.admins.join("\n"));
  }, [data]);

  if (loading) return <Loading what="the admin list" />;
  if (err || !data) return <ErrorNote err={err ?? "no data"} />;

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const list = val.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter((s) => s.includes("@"));
      const r = await api.setAdmins(list);
      setMsg(r.admins.length === 0 ? "Saved — everyone is an admin again." : `Saved — ${r.admins.length} admin(s).`);
      reload();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h3 style={{ margin: 0 }}>Admin access</h3>
      <p className="muted" style={{ maxWidth: "72ch" }}>
        One address per line (or comma-separated). These people see the <strong>Admin</strong> tab and
        can change structure, crosswalk, recipients, and reporting settings. Everyone else who signs
        in keeps full read access to the rest of the portal, plus Import and the weekly workflow.
      </p>
      <div className="note">
        {data.admins.length === 0 ? (
          <>
            <strong>Open.</strong> No list is set, so every signed-in user is an admin. Add addresses
            below to lock it down.
          </>
        ) : (
          <>
            <strong>{data.admins.length} admin(s).</strong> Clear the box and save to reopen it to
            everyone.
          </>
        )}
      </div>

      <div className="field" style={{ maxWidth: 480 }}>
        <label>Admin addresses</label>
        <textarea
          className="paste"
          style={{ minHeight: 140 }}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder={me?.user ?? "you@missionary.org"}
        />
      </div>
      <div className="row">
        <button className="btn primary" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save admin list"}
        </button>
        {me?.user && (
          <button
            className="btn"
            disabled={busy}
            onClick={() => setVal((v) => (v.includes(me.user) ? v : `${me.user}\n${v}`.trim()))}
          >
            Add me
          </button>
        )}
        {msg && <span className="muted" style={{ fontSize: ".85rem" }}>{msg}</span>}
      </div>
      <p className="muted" style={{ fontSize: ".8rem", marginTop: ".6rem" }}>
        A non-empty list must include your own address — the server won't let you lock yourself out.
      </p>
    </>
  );
}
