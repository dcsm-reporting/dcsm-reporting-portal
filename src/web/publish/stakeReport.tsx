import { forwardRef } from "react";
import { KI_IDS, KI_CODE, KI_NAME } from "@shared/ki";
import type { StakeReport } from "../api.js";

const doc: React.CSSProperties = {
  width: 760,
  background: "#fff",
  color: "#1c2530",
  fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
  padding: "36px 44px 40px",
  boxSizing: "border-box",
  fontSize: 13,
  lineHeight: 1.5,
};
const h2: React.CSSProperties = {
  fontFamily: '"IBM Plex Sans", sans-serif',
  fontSize: 14,
  fontWeight: 600,
  margin: "24px 0 8px",
  color: "#24406b",
};
const th: React.CSSProperties = {
  fontFamily: '"IBM Plex Mono", monospace',
  fontSize: 10,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  color: "#53606b",
  padding: "5px 8px",
  textAlign: "right",
  borderBottom: "1px solid #c3c9bd",
};
const td: React.CSSProperties = {
  padding: "5px 8px",
  textAlign: "right",
  borderBottom: "1px solid #e6e9e3",
};

function fmt(iso: string | null): string {
  if (!iso) return "–";
  const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][(m || 1) - 1];
  return y ? `${mon} ${d}` : iso;
}

function SparkRow({ label, values }: { label: string; values: number[] }) {
  const max = Math.max(1, ...values);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, margin: "2px 0" }}>
      <div style={{ width: 34, fontSize: 10, fontFamily: '"IBM Plex Mono", monospace', color: "#53606b", textAlign: "right", paddingRight: 4 }}>
        {label}
      </div>
      {values.map((v, i) => (
        <div
          key={i}
          title={String(v)}
          style={{
            width: 12,
            height: Math.max(2, Math.round((v / max) * 40)),
            background: i === values.length - 1 ? "#24406b" : "#9fb3cf",
          }}
        />
      ))}
      <div style={{ fontSize: 10, color: "#53606b", marginLeft: 4 }}>
        {values[values.length - 1]}
      </div>
    </div>
  );
}

export const StakeReportDoc = forwardRef<HTMLDivElement, { r: StakeReport; weekLabel: string; generatedAt: string }>(
  function StakeReportDoc({ r, weekLabel, generatedAt }, ref) {
    const seriesByKi: Record<string, number[]> = {};
    for (const ki of KI_IDS) seriesByKi[KI_CODE[ki]] = r.series.map((row) => row[KI_CODE[ki] as "NP"]);

    return (
      <div ref={ref} style={doc}>
        <div style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 11, letterSpacing: ".16em", textTransform: "uppercase", color: "#24406b" }}>
          Washington DC South Mission
        </div>
        <div style={{ fontFamily: '"Spectral", Georgia, serif', fontSize: 26, fontWeight: 600 }}>
          {r.stake} Stake
        </div>
        <div style={{ fontSize: 12, color: "#53606b" }}>
          Key Indicators of Conversion · {weekLabel}
        </div>

        <div style={{ display: "flex", gap: 28, marginTop: 16 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{r.baptizedThisMonth}</div>
            <div style={{ fontSize: 10, color: "#53606b", fontFamily: '"IBM Plex Mono", monospace', textTransform: "uppercase" }}>
              baptized this month
            </div>
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{r.baptizedYtd}</div>
            <div style={{ fontSize: 10, color: "#53606b", fontFamily: '"IBM Plex Mono", monospace', textTransform: "uppercase" }}>
              baptized year to date
            </div>
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{r.onDate.length}</div>
            <div style={{ fontSize: 10, color: "#53606b", fontFamily: '"IBM Plex Mono", monospace', textTransform: "uppercase" }}>
              friends on date
            </div>
          </div>
        </div>

        <h2 style={h2}>This week by ward</h2>
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
                <td style={{ ...td, textAlign: "left" }}>{w.ward}</td>
                {KI_IDS.map((ki) => (
                  <td key={ki} style={td}>
                    {w.ki[ki] ?? 0}
                  </td>
                ))}
              </tr>
            ))}
            <tr style={{ background: "#e5eaf2" }}>
              <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>{r.stake} total</td>
              {KI_IDS.map((ki) => (
                <td key={ki} style={{ ...td, fontWeight: 700 }}>
                  {r.total[ki] ?? 0}
                </td>
              ))}
            </tr>
          </tbody>
        </table>

        <h2 style={h2}>12-week trend</h2>
        <div style={{ columns: 2, columnGap: 32 }}>
          {KI_IDS.map((ki) => (
            <SparkRow key={ki} label={KI_CODE[ki]} values={seriesByKi[KI_CODE[ki]] ?? []} />
          ))}
        </div>

        <h2 style={h2}>Friends with a baptismal date ({r.onDate.length})</h2>
        {r.onDate.length === 0 ? (
          <div style={{ color: "#8a95a0" }}>None.</div>
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
                  <td style={{ ...td, textAlign: "left" }}>{f.name}</td>
                  <td style={{ ...td, textAlign: "left" }}>{f.ward ?? "–"}</td>
                  <td style={{ ...td, textAlign: "left" }}>{fmt(f.baptismDate)}</td>
                  <td style={td}>{f.attendedChurch2x ? "✓" : ""}</td>
                  <td style={td}>{f.onBaptismCalendar ? "✓" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h2 style={h2}>Baptized in the last 6 months ({r.baptized6mo.length})</h2>
        {r.baptized6mo.length === 0 ? (
          <div style={{ color: "#8a95a0" }}>None.</div>
        ) : (
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <tbody>
              {r.baptized6mo.map((f, i) => (
                <tr key={i}>
                  <td style={{ ...td, textAlign: "left" }}>
                    {f.name}
                    {f.confidence === "unverified" ? (
                      <span style={{ color: "#97620f", fontSize: 10 }}> (unverified)</span>
                    ) : null}
                  </td>
                  <td style={{ ...td, textAlign: "left" }}>{f.ward ?? "–"}</td>
                  <td style={{ ...td, textAlign: "left" }}>{fmt(f.baptismDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div style={{ marginTop: 26, fontSize: 10, color: "#8a95a0", fontFamily: '"IBM Plex Mono", monospace' }}>
          Generated {new Date(generatedAt).toLocaleString()} · DCSM Reporting
        </div>
      </div>
    );
  },
);
