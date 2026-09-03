import { forwardRef } from "react";
import { KI_CODE, KI_NAME } from "@shared/ki";
import { DEFAULT_STAKE_REPORT_LAYOUT, type StakeReportLayout } from "@shared/reportLayout";
import type { StakeReport } from "../api.js";

/*
 * The stake-president report. Sections, their order, and their options come
 * from the layout (Admin → Stake reports); this file only knows how to draw
 * each section. To add a *new kind* of section: add its id to
 * src/shared/reportLayout.ts, a label there, and a case in `renderSection`
 * below. Everything else (toggles, order, preview, saving) already works.
 */

const INK = "#1c2530";
const SOFT = "#53606b";
const FAINT = "#8a95a0";
const NAVY = "#24406b";
const RULE = "#c7ccd3";
const HAIR = "#e6e9ee";
const WASH = "#eef2f7";

const doc: React.CSSProperties = {
  width: 780,
  background: "#fff",
  color: INK,
  fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
  padding: "40px 46px 44px",
  boxSizing: "border-box",
  fontSize: 12.5,
  lineHeight: 1.5,
  fontVariantNumeric: "tabular-nums",
};

const eyebrow: React.CSSProperties = {
  fontFamily: '"IBM Plex Mono", monospace',
  fontSize: 10.5,
  letterSpacing: ".18em",
  textTransform: "uppercase",
  color: NAVY,
};

const sectionHead: React.CSSProperties = {
  fontFamily: '"IBM Plex Sans", sans-serif',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: ".04em",
  textTransform: "uppercase",
  color: NAVY,
  margin: "26px 0 10px",
  paddingLeft: 9,
  borderLeft: `3px solid ${NAVY}`,
};

const th: React.CSSProperties = {
  fontFamily: '"IBM Plex Mono", monospace',
  fontSize: 9.5,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  color: SOFT,
  padding: "6px 8px",
  textAlign: "right",
  borderBottom: `1.5px solid ${RULE}`,
  whiteSpace: "nowrap",
};
const td: React.CSSProperties = {
  padding: "6px 8px",
  textAlign: "right",
  borderBottom: `1px solid ${HAIR}`,
};
const tdL: React.CSSProperties = { ...td, textAlign: "left" };
const prose: React.CSSProperties = { fontSize: 12.5, lineHeight: 1.55, margin: "14px 0 0", whiteSpace: "pre-wrap" };

function fmt(iso: string | null): string {
  if (!iso) return "–";
  const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][(m || 1) - 1];
  return y ? `${mon} ${d}` : iso;
}

function StatTile({ n, label }: { n: number; label: string }) {
  return (
    <div style={{ flex: 1, border: `1px solid ${HAIR}`, borderRadius: 8, padding: "12px 14px" }}>
      <div style={{ fontSize: 26, fontWeight: 700, fontFamily: '"Spectral", Georgia, serif', lineHeight: 1 }}>
        {n}
      </div>
      <div
        style={{
          fontSize: 9.5,
          color: SOFT,
          fontFamily: '"IBM Plex Mono", monospace',
          textTransform: "uppercase",
          letterSpacing: ".05em",
          marginTop: 5,
        }}
      >
        {label}
      </div>
    </div>
  );
}

/* Inline SVG, not flex divs: Gmail strips `align-items: flex-end` when a
   message is sent, which flipped the CSS-height bars upside down. SVG rects
   are positioned absolutely from a baseline and survive that. */
function SparkRow({ label, values }: { label: string; values: number[] }) {
  const max = Math.max(1, ...values);
  const barW = 11;
  const gap = 2;
  const chartH = 40;
  const w = values.length * (barW + gap);
  const last = values[values.length - 1] ?? 0;
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, margin: "6px 0", breakInside: "avoid" }}>
      <div
        style={{
          width: 30,
          fontSize: 10,
          fontFamily: '"IBM Plex Mono", monospace',
          color: SOFT,
          textAlign: "right",
        }}
      >
        {label}
      </div>
      <svg width={w} height={chartH} viewBox={`0 0 ${w} ${chartH}`} style={{ display: "block" }}>
        {values.map((v, i) => {
          const h = Math.max(2, Math.round((v / max) * (chartH - 2)));
          return (
            <rect
              key={i}
              x={i * (barW + gap)}
              y={chartH - h}
              width={barW}
              height={h}
              fill={i === values.length - 1 ? NAVY : "#a9bcd6"}
            />
          );
        })}
      </svg>
      <div style={{ fontSize: 10, fontWeight: 600, color: SOFT }}>{last}</div>
    </div>
  );
}

interface Ctx {
  r: StakeReport;
  layout: StakeReportLayout;
  weekLabel: string;
}

function renderSection(id: StakeReportLayout["sections"][number]["id"], c: Ctx): React.ReactNode {
  const { r, layout: L } = c;
  switch (id) {
    case "intro":
      return L.introText.trim() ? <p key={id} style={prose}>{L.introText.trim()}</p> : null;

    case "stats": {
      const tiles: React.ReactNode[] = [];
      if (L.stats.baptizedThisMonth) tiles.push(<StatTile key="m" n={r.baptizedThisMonth} label="Baptized this month" />);
      if (L.stats.baptizedThisYear) tiles.push(<StatTile key="y" n={r.baptizedYtd} label="Baptized this year" />);
      if (L.stats.onDate) tiles.push(<StatTile key="d" n={r.onDate.length} label="On a baptismal date" />);
      return tiles.length ? (
        <div key={id} style={{ display: "flex", gap: 12, marginTop: 14 }}>{tiles}</div>
      ) : null;
    }

    case "wardTable":
      return (
        <div key={id}>
          <div style={sectionHead}>This week by unit</div>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: "left" }}>Unit</th>
                {L.kis.map((ki) => (
                  <th key={ki} style={th} title={KI_NAME[ki]}>
                    {KI_CODE[ki]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.wardTable.map((w) => (
                <tr key={w.ward}>
                  <td style={tdL}>{w.ward}</td>
                  {L.kis.map((ki) => (
                    <td key={ki} style={td}>{w.ki[ki] ?? 0}</td>
                  ))}
                </tr>
              ))}
              <tr style={{ background: WASH }}>
                <td style={{ ...tdL, fontWeight: 700, borderBottom: "none" }}>{r.stake} total</td>
                {L.kis.map((ki) => (
                  <td key={ki} style={{ ...td, fontWeight: 700, borderBottom: "none" }}>
                    {r.total[ki] ?? 0}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
          <div style={{ fontSize: 9.5, color: FAINT, marginTop: 6, fontFamily: '"IBM Plex Mono", monospace' }}>
            {L.kis.map((ki) => `${KI_CODE[ki]} ${KI_NAME[ki]}`).join("   ·   ")}
          </div>
        </div>
      );

    case "trend": {
      const n = r.series.length;
      return (
        <div key={id}>
          <div style={sectionHead}>{n}-week trend</div>
          <div style={{ columns: 2, columnGap: 40 }}>
            {L.kis.map((ki) => (
              <SparkRow key={ki} label={KI_CODE[ki]} values={r.series.map((row) => row[KI_CODE[ki] as "NP"])} />
            ))}
          </div>
        </div>
      );
    }

    case "onDate":
      return (
        <div key={id}>
          <div style={sectionHead}>Friends with a baptismal date ({r.onDate.length})</div>
          {r.onDate.length === 0 ? (
            <div style={{ color: FAINT }}>None.</div>
          ) : (
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: "left" }}>Name</th>
                  {L.onDate.ward && <th style={{ ...th, textAlign: "left" }}>Unit</th>}
                  <th style={{ ...th, textAlign: "left" }}>Date</th>
                  {L.onDate.church2x && <th style={th}>Church 2×</th>}
                  {L.onDate.calendar && <th style={th}>Calendar</th>}
                  {(L.onDate.extra ?? []).map((k) => (
                    <th key={k} style={{ ...th, textAlign: "left" }}>{k}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.onDate.map((f, i) => (
                  <tr key={i}>
                    <td style={tdL}>{f.name}</td>
                    {L.onDate.ward && <td style={tdL}>{f.ward ?? "–"}</td>}
                    <td style={tdL}>{fmt(f.baptismDate)}</td>
                    {L.onDate.church2x && (
                      <td style={{ ...td, color: f.attendedChurch2x ? "#1e7b45" : FAINT }}>
                        {f.attendedChurch2x ? "✓" : "–"}
                      </td>
                    )}
                    {L.onDate.calendar && (
                      <td style={{ ...td, color: f.onBaptismCalendar ? "#1e7b45" : FAINT }}>
                        {f.onBaptismCalendar ? "✓" : "–"}
                      </td>
                    )}
                    {(L.onDate.extra ?? []).map((k) => (
                      <td key={k} style={tdL}>{f.extra?.[k] ?? "–"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      );

    case "baptized":
      return (
        <div key={id}>
          <div style={sectionHead}>
            Baptized in the last {L.baptizedMonths} month{L.baptizedMonths === 1 ? "" : "s"} ({r.baptized6mo.length})
          </div>
          {r.baptized6mo.length === 0 ? (
            <div style={{ color: FAINT }}>None.</div>
          ) : (
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: "left" }}>Name</th>
                  <th style={{ ...th, textAlign: "left" }}>Unit</th>
                  <th style={{ ...th, textAlign: "left" }}>Date</th>
                </tr>
              </thead>
              <tbody>
                {r.baptized6mo.map((f, i) => (
                  <tr key={i}>
                    <td style={tdL}>
                      {f.name}
                      {L.showUnverified && f.confidence === "unverified" ? (
                        <span style={{ color: "#c4881a", fontSize: 9.5 }}> (unverified)</span>
                      ) : null}
                    </td>
                    <td style={tdL}>{f.ward ?? "–"}</td>
                    <td style={tdL}>{fmt(f.baptismDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      );

    case "note":
      return L.noteText.trim() ? (
        <p key={id} style={{ ...prose, marginTop: 24, color: SOFT }}>{L.noteText.trim()}</p>
      ) : null;
  }
}

export const StakeReportDoc = forwardRef<
  HTMLDivElement,
  { r: StakeReport; weekLabel: string; generatedAt: string; layout?: StakeReportLayout }
>(function StakeReportDoc({ r, weekLabel, generatedAt, layout = DEFAULT_STAKE_REPORT_LAYOUT }, ref) {
  const ctx: Ctx = { r, layout, weekLabel };
  return (
    <div ref={ref} style={doc}>
      <div style={eyebrow}>Washington DC South Mission</div>
      <div
        style={{
          fontFamily: '"Spectral", Georgia, serif',
          fontSize: 28,
          fontWeight: 600,
          letterSpacing: "-.01em",
          margin: "2px 0 1px",
        }}
      >
        {r.stake} Stake
      </div>
      <div style={{ fontSize: 12, color: SOFT }}>{layout.subtitle.replace("{week}", weekLabel)}</div>
      <div style={{ borderBottom: `2px solid ${NAVY}`, margin: "14px 0 4px" }} />

      {layout.sections.filter((s) => s.enabled).map((s) => renderSection(s.id, ctx))}

      <div
        style={{
          marginTop: 30,
          paddingTop: 10,
          borderTop: `1px solid ${HAIR}`,
          fontSize: 9.5,
          color: FAINT,
          fontFamily: '"IBM Plex Mono", monospace',
        }}
      >
        Weekly numbers from IMOS. Baptism and on-date names from the Baptisms (MLC) sheet. Generated{" "}
        {new Date(generatedAt).toLocaleString()} &middot; WDCSM Reporting
      </div>
    </div>
  );
});
