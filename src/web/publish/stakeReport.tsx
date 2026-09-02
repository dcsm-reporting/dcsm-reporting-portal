import { forwardRef } from "react";
import { KI_IDS, KI_CODE, KI_NAME } from "@shared/ki";
import type { StakeReport } from "../api.js";

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

function SparkRow({ label, values }: { label: string; values: number[] }) {
  const max = Math.max(1, ...values);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, margin: "6px 0", breakInside: "avoid" }}>
      <div
        style={{
          width: 30,
          fontSize: 10,
          fontFamily: '"IBM Plex Mono", monospace',
          color: SOFT,
          textAlign: "right",
          paddingRight: 4,
          paddingBottom: 2,
        }}
      >
        {label}
      </div>
      {values.map((v, i) => (
        <div
          key={i}
          style={{
            width: 11,
            height: Math.max(2, Math.round((v / max) * 38)),
            background: i === values.length - 1 ? NAVY : "#a9bcd6",
            borderRadius: 1,
          }}
        />
      ))}
      <div style={{ fontSize: 10, fontWeight: 600, color: SOFT, marginLeft: 5, paddingBottom: 1 }}>
        {values[values.length - 1] ?? 0}
      </div>
    </div>
  );
}

export const StakeReportDoc = forwardRef<
  HTMLDivElement,
  { r: StakeReport; weekLabel: string; generatedAt: string }
>(function StakeReportDoc({ r, weekLabel, generatedAt }, ref) {
  const seriesByKi: Record<string, number[]> = {};
  for (const ki of KI_IDS) seriesByKi[KI_CODE[ki]] = r.series.map((row) => row[KI_CODE[ki] as "NP"]);

  return (
    <div ref={ref} style={doc}>
      {/* header */}
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
      <div style={{ fontSize: 12, color: SOFT }}>Key Indicators of Conversion &middot; {weekLabel}</div>
      <div style={{ borderBottom: `2px solid ${NAVY}`, margin: "14px 0 18px" }} />

      {/* headline stats */}
      <div style={{ display: "flex", gap: 12 }}>
        <StatTile n={r.baptizedThisMonth} label="Baptized this month" />
        <StatTile n={r.baptizedYtd} label="Baptized this year" />
        <StatTile n={r.onDate.length} label="On a baptismal date" />
      </div>

      {/* ward KI table */}
      <div style={sectionHead}>This week by ward</div>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left" }}>Ward</th>
            {KI_IDS.map((ki) => (
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
              {KI_IDS.map((ki) => (
                <td key={ki} style={td}>{w.ki[ki] ?? 0}</td>
              ))}
            </tr>
          ))}
          <tr style={{ background: WASH }}>
            <td style={{ ...tdL, fontWeight: 700, borderBottom: "none" }}>{r.stake} total</td>
            {KI_IDS.map((ki) => (
              <td key={ki} style={{ ...td, fontWeight: 700, borderBottom: "none" }}>
                {r.total[ki] ?? 0}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <div style={{ fontSize: 9.5, color: FAINT, marginTop: 6, fontFamily: '"IBM Plex Mono", monospace' }}>
        {KI_IDS.map((ki) => `${KI_CODE[ki]} ${KI_NAME[ki]}`).join("   ·   ")}
      </div>

      {/* trend */}
      <div style={sectionHead}>12-week trend</div>
      <div style={{ columns: 2, columnGap: 40 }}>
        {KI_IDS.map((ki) => (
          <SparkRow key={ki} label={KI_CODE[ki]} values={seriesByKi[KI_CODE[ki]] ?? []} />
        ))}
      </div>

      {/* on date */}
      <div style={sectionHead}>Friends with a baptismal date ({r.onDate.length})</div>
      {r.onDate.length === 0 ? (
        <div style={{ color: FAINT }}>None.</div>
      ) : (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left" }}>Name</th>
              <th style={{ ...th, textAlign: "left" }}>Ward</th>
              <th style={{ ...th, textAlign: "left" }}>Date</th>
              <th style={th}>Church 2×</th>
              <th style={th}>Calendar</th>
            </tr>
          </thead>
          <tbody>
            {r.onDate.map((f, i) => (
              <tr key={i}>
                <td style={tdL}>{f.name}</td>
                <td style={tdL}>{f.ward ?? "–"}</td>
                <td style={tdL}>{fmt(f.baptismDate)}</td>
                <td style={{ ...td, color: f.attendedChurch2x ? "#1e7b45" : FAINT }}>
                  {f.attendedChurch2x ? "✓" : "–"}
                </td>
                <td style={{ ...td, color: f.onBaptismCalendar ? "#1e7b45" : FAINT }}>
                  {f.onBaptismCalendar ? "✓" : "–"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* baptized 6mo */}
      <div style={sectionHead}>Baptized in the last 6 months ({r.baptized6mo.length})</div>
      {r.baptized6mo.length === 0 ? (
        <div style={{ color: FAINT }}>None.</div>
      ) : (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left" }}>Name</th>
              <th style={{ ...th, textAlign: "left" }}>Ward</th>
              <th style={{ ...th, textAlign: "left" }}>Date</th>
            </tr>
          </thead>
          <tbody>
            {r.baptized6mo.map((f, i) => (
              <tr key={i}>
                <td style={tdL}>
                  {f.name}
                  {f.confidence === "unverified" ? (
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
        {new Date(generatedAt).toLocaleString()} &middot; DCSM Reporting
      </div>
    </div>
  );
});
