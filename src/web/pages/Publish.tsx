import { useRef, useState } from "react";
import { api, type PublishView } from "../api.js";
import { ErrorNote, Loading, PageHead, useAsync, useWeek } from "../lib.js";
import { Board, MlcBlock } from "../publish/boards.js";
import { StakeReportDoc } from "../publish/stakeReport.js";
import { copyRichHtml, downloadPng, gmailComposeUrl } from "../publish/download.js";
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

function scaleToFit(el: HTMLElement | null) {
  if (!el) return;
  const child = el.firstElementChild as HTMLElement | null;
  if (!child) return;
  const w = child.getBoundingClientRect().width;
  const avail = el.clientWidth;
  child.style.transform = avail < w ? `scale(${(avail - 2) / w})` : "none";
}

function Boards({ data }: { data: PublishView }) {
  const b = data.board;
  const zones = b.zones.filter((z) => z !== "MISSION");
  const [zone, setZone] = useState(zones[0] ?? "");
  const missionRef = useRef<HTMLDivElement>(null);
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
        <button className="btn primary" disabled={!!busy} onClick={() => dl(missionRef, `DCSM-board-${data.week}`)}>
          {busy.startsWith("DCSM-board") ? "Rendering…" : "Download mission board PNG"}
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
          <div style={{ padding: "0 40px 30px", background: "#fff" }}>
            <MlcBlock mlc={b.mlc} bands={b.bands.mlcShare} />
          </div>
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
          {busy.startsWith("DCSM-" + (ZONE_ABBR[zone] ?? zone)) ? "Rendering…" : `Download ${zone} PNG`}
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
  const r = data.reports.find((x) => x.stake === sel) ?? data.reports[0];
  const ref = useRef<HTMLDivElement>(null);
  const [msg, setMsg] = useState("");
  if (!r) return <p className="muted">No stakes yet. Seed the crosswalk.</p>;

  const printReport = () => {
    document.body.classList.add("printing");
    const done = () => {
      document.body.classList.remove("printing");
      window.removeEventListener("afterprint", done);
    };
    window.addEventListener("afterprint", done);
    setTimeout(() => window.print(), 50);
  };

  return (
    <>
      <div className="row no-print">
        <select value={sel} onChange={(e) => setSel(e.target.value)}>
          {data.reports.map((x) => (
            <option key={x.stake} value={x.stake}>{x.stake}</option>
          ))}
        </select>
        <button className="btn" onClick={printReport}>Print / Save PDF</button>
        <button
          className="btn"
          onClick={async () => {
            if (!ref.current) return;
            const ok = await copyRichHtml(ref.current);
            setMsg(ok ? "Copied. Paste into the email." : "Copy failed; use Print instead.");
            setTimeout(() => setMsg(""), 3000);
          }}
        >
          Copy for email
        </button>
        {r.toEmails.length > 0 && (
          <a
            className="btn"
            href={gmailComposeUrl(r.toEmails, r.ccEmails, `${r.stake} Stake, Key Indicators of Conversion (${data.weekLabel})`)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open in Gmail ↗
          </a>
        )}
        {msg && <span className="muted" style={{ fontSize: ".85rem" }}>{msg}</span>}
      </div>

      <div className="no-print" style={{ fontSize: ".82rem", color: "var(--ink-soft)", marginTop: ".4rem" }}>
        {r.toEmails.length === 0 ? (
          <>
            No recipients on file for {r.stake}. Add them in <strong>Structure → Recipients</strong> or seed from the
            EMAILS sheet.
          </>
        ) : (
          <div className="recipient-chips">
            {r.toEmails.map((e) => <span key={e} className="chip to">{e}</span>)}
            {r.ccEmails.map((e) => <span key={e} className="chip">cc {e}</span>)}
          </div>
        )}
      </div>

      <div className="publish-preview print-target" ref={(el) => scaleToFit(el)} style={{ marginTop: ".8rem" }}>
        <StakeReportDoc ref={ref} r={r} weekLabel={data.weekLabel} generatedAt={data.generatedAt} />
      </div>
    </>
  );
}
