import { useEffect, useRef, useState } from "react";
import { api, type PublishView } from "../api.js";
import { ErrorNote, Loading, PageHead, useAsync, useWeek } from "../lib.js";
import { Board, MlcBoard } from "../publish/boards.js";
import { StakeReportDoc } from "../publish/stakeReport.js";
import { copyEmail, copyRichHtml, downloadPdf, downloadPng, gmailComposeUrl } from "../publish/download.js";
import { buildEmail } from "../publish/email.js";
import "../publish/publish.css";

const ZONE_ABBR: Record<string, string> = {
  Alexandria: "AX", Annandale: "AN", "Bull Run": "BR", McLean: "MC", Oakton: "OK",
  Langley: "LA", Loudoun: "LD", Woodbridge: "WB", Manassas: "MS", Potomac: "PO",
};

export function PublishPage() {
  const { week } = useWeek();
  const { data, err, loading } = useAsync(
    () => (week ? api.publish(week) : Promise.resolve(null)),
    [week],
  );
  const [tab, setTab] = useState<"boards" | "reports">("boards");

  if (!week) return <p className="muted">No weeks imported yet.</p>;
  if (loading) return <Loading what="the publish bundle" />;
  if (err) return <ErrorNote err={err} />;
  if (!data) return null;

  return (
    <>
      <PageHead title={`Publish: ${data.weekLabel}`} week>
        <nav className="subnav no-print" style={{ margin: 0, border: "none", padding: 0 }}>
          <a className={tab === "boards" ? "active" : ""} onClick={() => setTab("boards")} style={{ cursor: "pointer" }}>Boards</a>
          <a className={tab === "reports" ? "active" : ""} onClick={() => setTab("reports")} style={{ cursor: "pointer" }}>Stake reports</a>
        </nav>
      </PageHead>
      {tab === "boards" ? <Boards data={data} /> : <Reports data={data} />}
    </>
  );
}

/** Scale the fixed-width board/report down to fit the preview box, and collapse
 *  the box to the scaled height so there's no dead space below it. The scaled
 *  node is always .publish-preview's first child; its natural width is either
 *  its own (a fixed-width doc) or its child's (an unstyled wrapper). */
function fit(el: HTMLElement) {
  const wrap = el.firstElementChild as HTMLElement | null;
  if (!wrap) return;
  wrap.style.transform = "none";
  const child = wrap.firstElementChild as HTMLElement | null;
  const natW = Math.max(wrap.offsetWidth, child?.offsetWidth ?? 0) || 1;
  const avail = el.clientWidth;
  const scale = avail < natW ? (avail - 2) / natW : 1;
  wrap.style.transform = scale === 1 ? "none" : `scale(${scale})`;
  el.style.height = scale === 1 ? "" : `${Math.ceil(wrap.offsetHeight * scale)}px`;
  el.style.overflow = scale === 1 ? "auto" : "hidden";
}
function scaleToFit(el: HTMLElement | null) {
  if (!el) return;
  requestAnimationFrame(() => fit(el));
  // fonts / late layout — settle once more
  setTimeout(() => fit(el), 350);
}

function Boards({ data }: { data: PublishView }) {
  const b = data.board;
  const zones = b.zones.filter((z) => z !== "MISSION");
  const [zone, setZone] = useState(zones[0] ?? "");
  // the selected zone may not exist in a different week — snap back to the first
  useEffect(() => {
    if (!zones.includes(zone)) setZone(zones[0] ?? "");
  }, [data.week]); // eslint-disable-line react-hooks/exhaustive-deps
  const missionRef = useRef<HTMLDivElement>(null);
  const mlcRef = useRef<HTMLDivElement>(null);
  const zoneRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState("");

  const dl = async (ref: React.RefObject<HTMLDivElement>, name: string) => {
    if (!ref.current) return;
    setBusy(name);
    try {
      await downloadPng(ref.current, name);
    } finally {
      setBusy("");
    }
  };

  const areaGrid = b.byArea[zone] ?? {};
  const areaNames = Object.keys(areaGrid);

  return (
    <>
      <div className="row no-print">
        <button
          className="btn primary"
          disabled={!!busy}
          onClick={() => dl(missionRef, `DCSM-mission-${data.week}`)}
        >
          {busy === `DCSM-mission-${data.week}` ? "Rendering…" : "Download mission board"}
        </button>
        <button
          className="btn primary"
          disabled={!!busy}
          onClick={() => dl(mlcRef, `DCSM-MLC-${data.week}`)}
        >
          {busy === `DCSM-MLC-${data.week}` ? "Rendering…" : "Download MLC board"}
        </button>
      </div>

      <div className="publish-preview" ref={(el) => scaleToFit(el)} style={{ marginTop: ".8rem" }}>
        <div ref={missionRef}>
          <Board
            title="Mission"
            weekLabel={data.weekLabel}
            rows={b.zones}
            grid={b.byZone}
            totalKey="MISSION"
            bands={b.bands.goalPct}
          />
        </div>
      </div>

      <div className="publish-preview" ref={(el) => scaleToFit(el)} style={{ marginTop: ".8rem" }}>
        <div ref={mlcRef}>
          <MlcBoard weekLabel={data.weekLabel} mlc={b.mlc} bands={b.bands.mlcShare} />
        </div>
      </div>

      <h3 className="no-print">Zone board</h3>
      <div className="row no-print">
        <select value={zone} onChange={(e) => setZone(e.target.value)}>
          {zones.map((z) => (
            <option key={z} value={z}>{z}</option>
          ))}
        </select>
        <button
          className="btn"
          disabled={!!busy}
          onClick={() => dl(zoneRef, `DCSM-${ZONE_ABBR[zone] ?? zone}-${data.week}`)}
        >
          {busy === `DCSM-${ZONE_ABBR[zone] ?? zone}-${data.week}` ? "Rendering…" : `Download ${zone} board`}
        </button>
      </div>
      <div className="publish-preview" ref={(el) => scaleToFit(el)} style={{ marginTop: ".8rem" }}>
        <div ref={zoneRef}>
          <Board
            title={`${zone} Zone`}
            weekLabel={data.weekLabel}
            rows={[...areaNames, zone.toUpperCase()]}
            grid={areaGrid}
            totalKey={zone.toUpperCase()}
            bands={b.bands.goalPct}
          />
        </div>
      </div>
    </>
  );
}

function Reports({ data }: { data: PublishView }) {
  const [sel, setSel] = useState(data.reports[0]?.stake ?? "");
  const ref = useRef<HTMLDivElement>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const r = data.reports.find((x) => x.stake === sel) ?? data.reports[0];

  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(""), 3000);
  };
  const savePdf = async () => {
    if (!ref.current) return;
    setBusy(true);
    try {
      await downloadPdf(ref.current, `${r!.stake}-KIC-${data.week}`);
    } catch {
      flash("PDF failed. Try Copy full email instead.");
    } finally {
      setBusy(false);
    }
  };

  if (!r) return <p className="muted">No stakes yet. Seed the crosswalk.</p>;

  const email = buildEmail({
    stake: r.stake,
    presidentName: r.presidentName,
    weekStartIso: data.week,
    weekLabel: data.weekLabel,
    template: data.emailTemplate,
  });

  return (
    <>
      <div className="row no-print">
        <select value={sel} onChange={(e) => setSel(e.target.value)}>
          {data.reports.map((x) => (
            <option key={x.stake} value={x.stake}>{x.stake}</option>
          ))}
        </select>
        <button className="btn primary" disabled={busy} onClick={savePdf}>
          {busy ? "Building PDF…" : "Download PDF"}
        </button>
        {r.toEmails.length > 0 && (
          <a
            className="btn"
            href={gmailComposeUrl(r.toEmails, r.ccEmails, email.subject, email.bodyText)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open in Gmail ↗
          </a>
        )}
        <button
          className="btn"
          onClick={async () => {
            if (!ref.current) return;
            const ok = await copyEmail(email.bodyHtml, email.bodyText, ref.current);
            flash(ok ? "Letter + report copied. Paste into the email body." : "Copy failed.");
          }}
        >
          Copy full email
        </button>
        <button
          className="btn"
          onClick={async () => {
            if (!ref.current) return;
            const ok = await copyRichHtml(ref.current);
            flash(ok ? "Report copied." : "Copy failed.");
          }}
        >
          Copy report only
        </button>
        {msg && <span className="muted" style={{ fontSize: ".85rem" }}>{msg}</span>}
      </div>

      <div className="no-print" style={{ fontSize: ".82rem", color: "var(--ink-soft)", marginTop: ".4rem" }}>
        {r.toEmails.length === 0 ? (
          <>
            No recipients on file for {r.stake}. Add them in <strong>Structure → Recipients</strong>.
          </>
        ) : (
          <div className="recipient-chips">
            {r.toEmails.map((e) => <span key={e} className="chip to">{e}</span>)}
            {r.ccEmails.map((e) => <span key={e} className="chip">cc {e}</span>)}
            {r.ccEmails.length === 0 && <span className="muted">no CC list set</span>}
          </div>
        )}
      </div>
      <div className="no-print" style={{ fontSize: ".8rem", color: "var(--ink-faint)", marginTop: ".3rem", maxWidth: "76ch" }}>
        Two ways to send: <strong>Copy full email</strong> then Open in Gmail and paste (one step, the
        report lands inline) — or <strong>Download PDF</strong>, Open in Gmail, and attach the file
        (Gmail can't attach it automatically from a link).
      </div>

      <div className="publish-preview print-target" ref={(el) => scaleToFit(el)} style={{ marginTop: ".8rem" }}>
        <StakeReportDoc ref={ref} r={r} weekLabel={data.weekLabel} generatedAt={data.generatedAt} />
      </div>
    </>
  );
}
