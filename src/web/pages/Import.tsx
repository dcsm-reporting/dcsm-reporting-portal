import { useMemo, useState } from "react";
import { api, type ImportSummary } from "../api.js";
import { PageHead, useWeek } from "../lib.js";

const IMOS_BASE = "https://imos.churchofjesuschrist.org/ws/auth-controller/api-v1/ki/report";

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
/** Monday–Sunday of the most recent reporting week that has fully passed. */
function lastCompleteWeek(today = new Date()): { monday: string; sunday: string } {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const dow = d.getUTCDay(); // 0=Sun … 6=Sat
  const backToSunday = dow === 0 ? 7 : dow; // if today is Sunday, use the previous Sunday
  const sunday = new Date(d);
  sunday.setUTCDate(d.getUTCDate() - backToSunday);
  const monday = new Date(sunday);
  monday.setUTCDate(sunday.getUTCDate() - 6);
  return { monday: iso(monday), sunday: iso(sunday) };
}
function shift(mondayIso: string, weeks: number): { monday: string; sunday: string } {
  const m = new Date(`${mondayIso}T00:00:00Z`);
  m.setUTCDate(m.getUTCDate() + weeks * 7);
  const s = new Date(m);
  s.setUTCDate(m.getUTCDate() + 6);
  return { monday: iso(m), sunday: iso(s) };
}

export function ImportPage() {
  const { setWeek } = useWeek();
  const [range, setRange] = useState(() => lastCompleteWeek());
  const [custom, setCustom] = useState(false);
  const [customRange, setCustomRange] = useState(() => lastCompleteWeek());

  const active = custom ? customRange : range;
  const url = `${IMOS_BASE}/${active.monday}/${active.sunday}`;
  const spanDays = useMemo(() => {
    const a = Date.parse(`${active.monday}T00:00:00Z`);
    const b = Date.parse(`${active.sunday}T00:00:00Z`);
    return Math.round((b - a) / 86_400_000) + 1;
  }, [active]);

  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ImportSummary | null>(null);
  const [committed, setCommitted] = useState<ImportSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function doPreview() {
    setBusy(true);
    setErr(null);
    setCommitted(null);
    setPreview(null);
    try {
      setPreview((await api.importPreview(raw)).summary);
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
      <PageHead title="Import an IMOS week" />
      <p className="muted" style={{ maxWidth: "70ch" }}>
        Pick the reporting week, open it in IMOS (you’ll need to be signed in to a missionary
        account), copy the whole JSON response, and paste it below. Retrieval stays manual; the
        Church login is never automated.
      </p>

      {/* week selector + URL */}
      <div className="drawer">
        {!custom ? (
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div className="row">
              <button className="btn" onClick={() => setRange((r) => shift(r.monday, -1))}>◂ earlier</button>
              <strong className="mono">{active.monday} → {active.sunday}</strong>
              <button className="btn" onClick={() => setRange((r) => shift(r.monday, 1))}>later ▸</button>
              <button className="btn" onClick={() => setRange(lastCompleteWeek())}>most recent</button>
            </div>
            <label className="row" style={{ gap: ".3rem" }}>
              <input type="checkbox" checked={custom} onChange={(e) => setCustom(e.target.checked)} />
              <span className="muted" style={{ fontSize: ".8rem" }}>custom range</span>
            </label>
          </div>
        ) : (
          <div className="row">
            <label className="field" style={{ margin: 0 }}>
              <span className="k mono">start</span>
              <input type="date" value={customRange.monday} onChange={(e) => setCustomRange((r) => ({ ...r, monday: e.target.value }))} />
            </label>
            <label className="field" style={{ margin: 0 }}>
              <span className="k mono">end</span>
              <input type="date" value={customRange.sunday} onChange={(e) => setCustomRange((r) => ({ ...r, sunday: e.target.value }))} />
            </label>
            <label className="row" style={{ gap: ".3rem" }}>
              <input type="checkbox" checked={custom} onChange={(e) => setCustom(e.target.checked)} />
              <span className="muted" style={{ fontSize: ".8rem" }}>custom range</span>
            </label>
          </div>
        )}

        <div className="row" style={{ marginTop: ".8rem" }}>
          <a className="btn primary" href={url} target="_blank" rel="noopener noreferrer">Open in IMOS ↗</a>
          <button
            className="btn"
            onClick={() => {
              navigator.clipboard?.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            }}
          >
            {copied ? "Copied" : "Copy URL"}
          </button>
          <code style={{ fontSize: ".72rem", wordBreak: "break-all" }}>{url}</code>
        </div>

        {spanDays !== 7 && (
          <div className="note warn" style={{ marginTop: ".8rem" }}>
            This range is {spanDays} days. IMOS will happily return it, but it isn’t a Mon to Sun
            week: importing it stores one aggregated row under {active.monday}, which will skew the
            weekly series. Use it only for a deliberate one-off.
          </div>
        )}
      </div>

      <div className="field">
        <label>IMOS report JSON</label>
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

      {preview && <SummaryBlock s={preview} heading="Validation (not yet stored)" />}
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
  const span =
    Math.round(
      (Date.parse(`${s.weekEnd}T00:00:00Z`) - Date.parse(`${s.weekStart}T00:00:00Z`)) / 86_400_000,
    ) + 1;
  return (
    <>
      <h3>{heading}</h3>
      <div className="cards">
        <Stat k="Week" v={s.weekLabel} sub={`${s.weekStart} → ${s.weekEnd} · ${span} days`} />
        <Stat k="Active areas" v={s.activeAreas} />
        <Stat k="Data points" v={s.nFacts} />
        <Stat k="Ward rows" v={s.nWardFacts} />
        <Stat k="Missionaries" v={s.nMissionaries} />
      </div>
      {span !== 7 && (
        <div className="note warn">This payload covers {span} days, not a normal week.</div>
      )}
      {s.alreadyStored && (
        <div className="note warn">A week with this start date is already stored; committing overwrites its rows.</div>
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
          They import fine; resolve them in <strong>Structure → Rollover</strong> so stake rollups pick them up.
        </div>
      )}
      {s.warnings.length === 0 && s.unmapped.length === 0 && span === 7 && (
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
