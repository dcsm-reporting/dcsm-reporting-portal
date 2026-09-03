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
  const [viewers, setViewers] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (data) {
      setVal(data.admins.join("\n"));
      setViewers((data.viewers ?? []).join("\n"));
    }
  }, [data]);

  if (loading) return <Loading what="the admin list" />;
  if (err || !data) return <ErrorNote err={err ?? "no data"} />;

  const saveViewers = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const list = viewers.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter((s) => s.includes("@"));
      const r = await api.setViewers(list);
      setMsg(
        r.viewers.length === 0
          ? "Saved. Everyone Cloudflare Access lets in can view."
          : `Saved. ${r.viewers.length} viewer(s) plus the admins.`,
      );
      reload();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const list = val.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter((s) => s.includes("@"));
      const r = await api.setAdmins(list);
      setMsg(r.admins.length === 0 ? "Saved. Everyone is an admin again." : `Saved. ${r.admins.length} admin(s).`);
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
        One address per line. Admins see the <strong>Console</strong> and <strong>Admin</strong> tabs
        and can change structure, units, stake reports, and reporting settings. Everyone else can view
        every other page, import weeks, and publish.
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
        The list must include your own address, so you cannot lock yourself out.
      </p>

      <h3 style={{ marginTop: "2.2rem" }}>Who can view</h3>
      <p className="muted" style={{ maxWidth: "72ch" }}>
        Cloudflare Access admits the mission’s email domains. This list narrows that to named
        people: mission leadership, office staff, and anyone else the president approves. Admins
        are always included. Leave it empty to admit everyone Access lets in.
      </p>
      <div className="note">
        {(data.viewers ?? []).length === 0 ? (
          <>
            <strong>Open to the mission domains.</strong> Any @missionary.org or
            @churchofjesuschrist.org account can view friends’ names, baptism dates, and the
            missionary roster. List the approved people below to close that.
          </>
        ) : (
          <>
            <strong>{data.viewers!.length} viewer(s)</strong> plus the admins. Everyone else who signs
            in sees a “not authorized” page.
          </>
        )}
      </div>
      <div className="field" style={{ maxWidth: 480 }}>
        <label>Viewer addresses</label>
        <textarea
          className="paste"
          style={{ minHeight: 140 }}
          value={viewers}
          onChange={(e) => setViewers(e.target.value)}
          placeholder="president@missionary.org&#10;secretary@missionary.org"
        />
      </div>
      <div className="row">
        <button className="btn primary" disabled={busy} onClick={saveViewers}>
          {busy ? "Saving…" : "Save viewer list"}
        </button>
      </div>
    </>
  );
}
