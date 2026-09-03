import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type ImportSummary, type StructureDiff } from "../api.js";
import { PageHead, useWeek } from "../lib.js";
import { addDays, dayOfWeekMonday0, lastCompleteWeekOf, todayIso } from "@shared/dates";

const IMOS_BASE = "https://imos.churchofjesuschrist.org/ws/auth-controller/api-v1/ki/report";

/** Monday–Sunday of the most recent reporting week that has fully passed (mission tz). */
function lastCompleteWeek(): { monday: string; sunday: string } {
  return lastCompleteWeekOf(todayIso());
}
function shift(mondayIso: string, weeks: number): { monday: string; sunday: string } {
  const monday = addDays(mondayIso, weeks * 7);
  return { monday, sunday: addDays(monday, 6) };
}

export function ImportPage() {
  const { setWeek, refreshWeeks, weeks, missing } = useWeek();
  const [range, setRange] = useState(() => lastCompleteWeek());
  const [custom, setCustom] = useState(false);
  const [customRange, setCustomRange] = useState(() => lastCompleteWeek());
  const [force, setForce] = useState(false);
  const stored = useMemo(() => new Set(weeks.map((w) => w.weekStart)), [weeks]);

  const active = custom ? customRange : range;
  const url = `${IMOS_BASE}/${active.monday}/${active.sunday}`;
  const spanDays = useMemo(() => {
    const a = Date.parse(`${active.monday}T00:00:00Z`);
    const b = Date.parse(`${active.sunday}T00:00:00Z`);
    return Math.round((b - a) / 86_400_000) + 1;
  }, [active]);
  const startsMonday = /^\d{4}-\d{2}-\d{2}$/.test(active.monday) && dayOfWeekMonday0(active.monday) === 0;
  const alreadyStored = stored.has(active.monday);

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
  const [staleRemoved, setStaleRemoved] = useState(0);
  async function doCommit() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.importCommit(raw, force);
      setCommitted(r.summary);
      setStaleRemoved(r.stored?.staleRemoved ?? 0);
      setPreview(null);
      // the week list is what the picker offers; refresh it so the new week
      // is selectable everywhere, then select it
      await refreshWeeks().catch(() => {});
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

        {(spanDays !== 7 || !startsMonday) && (
          <div className="note warn" style={{ marginTop: ".8rem" }}>
            {spanDays !== 7
              ? `This range is ${spanDays} days, not a Monday to Sunday week.`
              : `${active.monday} is not a Monday; reporting weeks run Monday to Sunday.`}{" "}
            IMOS will happily return it, but importing it would store one aggregated row under{" "}
            {active.monday} and skew the weekly series. The portal refuses it unless you tick
            “store anyway” below.
          </div>
        )}
        {alreadyStored && spanDays === 7 && startsMonday && (
          <div className="note" style={{ marginTop: ".8rem" }}>
            This week is already stored. Re-importing replaces its numbers with the new pull and
            removes any area that is no longer in the report.
          </div>
        )}
        {missing.length > 0 && (
          <div className="note warn" style={{ marginTop: ".8rem" }}>
            <strong>
              {missing.length} week{missing.length === 1 ? "" : "s"} never imported:
            </strong>{" "}
            {missing.map((m) => (
              <button
                key={m}
                className="btn"
                style={{ marginRight: ".3rem", fontSize: ".78rem", padding: "2px 8px" }}
                onClick={() => {
                  setCustom(false);
                  setRange({ monday: m, sunday: addDays(m, 6) });
                }}
              >
                {m}
              </button>
            ))}
            <span className="muted" style={{ fontSize: ".8rem" }}>
              {" "}
              Trends and 4-week totals skip them; click one to load its range.
            </span>
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
          <button
            className="btn primary"
            onClick={doCommit}
            disabled={busy || ((preview.weekly === false || !!preview.structure?.storedDrift) && !force)}
          >
            Commit week {preview.weekStart}
          </button>
        )}
        {preview && (preview.weekly === false || preview.structure?.storedDrift) && (
          <label className="row" style={{ gap: ".3rem" }}>
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
            <span style={{ fontSize: ".85rem" }}>
              store anyway{preview.weekly === false ? " (not a Mon to Sun week)" : " (replaces this week's structure)"}
            </span>
          </label>
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
            {staleRemoved > 0 &&
              ` ${staleRemoved} row(s) from the earlier import of this week were no longer in the report and were removed.`}
            {committed.structure?.transfer && (
              <>
                {" "}
                A transfer landed in this week: <Link to={`/admin/rollover?w=${committed.weekStart}`}>run Rollover now</Link>.
              </>
            )}
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
      {s.weekly === false && (
        <div className="note warn">
          This payload ({s.weekStart} to {s.weekEnd}, {span} days) is not a Monday to Sunday
          reporting week. It will not be stored unless you tick “store anyway”.
        </div>
      )}
      {s.alreadyStored && !s.structure?.storedDrift && (
        <div className="note warn">A week with this start date is already stored; committing overwrites its rows.</div>
      )}
      {s.structure?.storedDrift && s.structure.vsStored && (
        <div className="note stop">
          <strong>This week is already stored with a different structure.</strong> Committing would
          add {s.structure.vsStored.areasNew.length} area(s), remove {s.structure.vsStored.areasGone.length},
          and move {s.structure.vsStored.movedZone.length} between zones. That is right after a correction in
          IMOS, and wrong if this is the wrong pull. Tick “store anyway” only if you are sure.
        </div>
      )}
      {s.structure?.transfer && s.structure.vsPrev && <TransferBlock d={s.structure.vsPrev} />}
      {(s.notes?.length ?? 0) > 0 && (
        <div className="note warn">
          <strong>Transfer-week notes:</strong>
          <ul>{s.notes!.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </div>
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
      {s.warnings.length === 0 && s.unmapped.length === 0 && s.weekly !== false && (
        <div className="note ok">All checks clean.</div>
      )}
    </>
  );
}

/** What moved since the previous stored week — a transfer, announced at import time. */
function TransferBlock({ d }: { d: StructureDiff }) {
  const n = d.areasNew.length + d.areasGone.length + d.movedZone.length + d.zonesNew.length + d.zonesGone.length;
  return (
    <div className="note">
      <strong>Structure changed since {d.week}</strong> ({n} change{n === 1 ? "" : "s"}). Numbers
      import fine; after committing, run <Link to="/admin/rollover">Admin → Rollover</Link> for this
      week so the new areas and wards are mapped.
      <ul style={{ margin: ".4rem 0 0", fontSize: ".85rem" }}>
        {d.zonesNew.length > 0 && <li>New zone{d.zonesNew.length === 1 ? "" : "s"}: {d.zonesNew.join(", ")}</li>}
        {d.zonesGone.length > 0 && <li>Zone{d.zonesGone.length === 1 ? "" : "s"} gone: {d.zonesGone.join(", ")}</li>}
        {d.areasNew.length > 0 && (
          <li>
            New area{d.areasNew.length === 1 ? "" : "s"}: {d.areasNew.map((a) => `${a.name} (${a.zone})`).join(", ")}
          </li>
        )}
        {d.areasGone.length > 0 && (
          <li>
            Area{d.areasGone.length === 1 ? "" : "s"} gone: {d.areasGone.map((a) => `${a.name} (${a.zone})`).join(", ")}
          </li>
        )}
        {d.movedZone.length > 0 && (
          <li>
            Moved zone: {d.movedZone.map((a) => `${a.name} ${a.from} → ${a.to}`).join(", ")}
          </li>
        )}
        {d.renamed.length > 0 && (
          <li>Renamed: {d.renamed.map((a) => `${a.from} → ${a.to}`).join(", ")}</li>
        )}
        {d.wardsNew.length > 0 && <li>New ward{d.wardsNew.length === 1 ? "" : "s"}: {d.wardsNew.map((w) => w.name).join(", ")}</li>}
        {d.wardsGone.length > 0 && <li>Ward{d.wardsGone.length === 1 ? "" : "s"} no longer covered: {d.wardsGone.map((w) => w.name).join(", ")}</li>}
      </ul>
    </div>
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
