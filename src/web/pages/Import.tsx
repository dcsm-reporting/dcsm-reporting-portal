import { useState } from "react";
import { api, type ImportSummary } from "../api.js";
import { useWeek } from "../lib.js";

const IMOS_URL_HINT =
  "https://imos.churchofjesuschrist.org/ws/auth-controller/api-v1/ki/report/{Mon}/{Sun}";

export function ImportPage() {
  const { setWeek } = useWeek();
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ImportSummary | null>(null);
  const [committed, setCommitted] = useState<ImportSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function doPreview() {
    setBusy(true);
    setErr(null);
    setCommitted(null);
    setPreview(null);
    try {
      const r = await api.importPreview(raw);
      setPreview(r.summary);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function doCommit() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.importCommit(raw);
      setCommitted(r.summary);
      setPreview(null);
      setWeek(r.summary.weekStart);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h2>Import an IMOS week</h2>
      <p className="muted" style={{ maxWidth: "70ch" }}>
        Open the KI report URL signed in to a missionary account, copy the whole JSON response, and
        paste it below. Retrieval is manual by design — the Church login is never automated.
      </p>
      <p className="mono muted" style={{ fontSize: ".78rem" }}>{IMOS_URL_HINT}</p>

      <div className="field">
        <label>IMOS KI report JSON</label>
        <textarea
          className="paste"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="Paste the JSON payload here…"
        />
      </div>

      <div className="row">
        <button className="btn" onClick={doPreview} disabled={busy || raw.trim().length < 20}>
          {busy ? "Checking…" : "Validate"}
        </button>
        {preview && (
          <button className="btn primary" onClick={doCommit} disabled={busy}>
            Commit week {preview.weekStart}
          </button>
        )}
      </div>

      {err && (
        <div className="note stop">
          <strong>Import blocked.</strong> {err}
        </div>
      )}

      {preview && <SummaryBlock s={preview} heading="Validation — not yet stored" />}
      {committed && (
        <>
          <div className="note ok">
            <strong>Stored.</strong> Week {committed.weekStart} is now the selected week.
          </div>
          <SummaryBlock s={committed} heading="Imported" />
        </>
      )}
    </>
  );
}

function SummaryBlock({ s, heading }: { s: ImportSummary; heading: string }) {
  return (
    <>
      <h3>{heading}</h3>
      <div className="cards">
        <Stat k="Week" v={s.weekLabel} sub={`${s.weekStart} → ${s.weekEnd}`} />
        <Stat k="Active areas" v={s.activeAreas} />
        <Stat k="KI facts" v={s.nFacts} />
        <Stat k="Ward rows" v={s.nWardFacts} />
        <Stat k="Missionaries" v={s.nMissionaries} />
      </div>
      {s.alreadyStored && (
        <div className="note warn">A week with this start date is already stored — committing overwrites its rows.</div>
      )}
      {s.warnings.length > 0 && (
        <div className="note warn">
          <strong>{s.warnings.length} warning(s):</strong>
          <ul>{s.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}
      {s.unmapped.length > 0 && (
        <div className="note warn">
          <strong>{s.unmapped.length} area(s) not in the crosswalk:</strong>{" "}
          {s.unmapped.map((u) => `${u.imosAreaName} (${u.imosAreaId})`).join(", ")}.
          <br />
          They import fine; resolve them in Admin → Crosswalk so stake rollups pick them up.
        </div>
      )}
      {s.warnings.length === 0 && s.unmapped.length === 0 && (
        <div className="note ok">All checks clean.</div>
      )}
    </>
  );
}

function Stat({ k, v, sub }: { k: string; v: React.ReactNode; sub?: string }) {
  return (
    <div className="card">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

function errText(e: unknown): string {
  const anyE = e as { data?: { error?: string; kind?: string }; message?: string };
  if (anyE?.data?.error) return anyE.data.error;
  return anyE?.message ?? String(e);
}
