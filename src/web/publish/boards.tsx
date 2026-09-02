import { forwardRef } from "react";
import { KI_IDS, KI_CODE, KI_NAME } from "@shared/ki";
import type { KiCell, ZoneGrid } from "@pipeline/types";

type Bands = { low: number; mid: number };

function band(pct: number | null, b: Bands): string {
  if (pct == null) return "#8a95a0";
  if (pct < b.low) return "#9a3b34";
  if (pct < b.mid) return "#97620f";
  return "#2f6b46";
}
function bandBg(pct: number | null, b: Bands): string {
  if (pct == null) return "transparent";
  if (pct < b.low) return "#f6e7e5";
  if (pct < b.mid) return "#f7efdd";
  return "#e4efe8";
}

function Cell({ c, bands }: { c: KiCell | undefined; bands: Bands }) {
  if (!c) return <td style={td}>–</td>;
  return (
    <td style={{ ...td, background: bandBg(c.pct, bands) }}>
      <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1, color: "#1c2530" }}>{c.actual}</div>
      <div style={{ fontSize: 11, color: "#53606b" }}>
        {c.goal != null ? `goal ${c.goal}` : "–"}
        {c.pct != null && (
          <span style={{ color: band(c.pct, bands), fontWeight: 600 }}> · {c.pct}%</span>
        )}
      </div>
    </td>
  );
}

const wrap: React.CSSProperties = {
  width: 1040,
  background: "#ffffff",
  color: "#1c2530",
  fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
  padding: "34px 40px 28px",
  boxSizing: "border-box",
};
const th: React.CSSProperties = {
  fontFamily: '"IBM Plex Mono", monospace',
  fontSize: 12,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "#53606b",
  padding: "8px 10px",
  textAlign: "right",
  borderBottom: "2px solid #c3c9bd",
  whiteSpace: "nowrap",
};
const td: React.CSSProperties = {
  padding: "8px 10px",
  textAlign: "right",
  borderBottom: "1px solid #dbdfd9",
  whiteSpace: "nowrap",
};
const rowHead: React.CSSProperties = { ...td, textAlign: "left", fontWeight: 600 };

function Header({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div
        style={{
          fontFamily: '"IBM Plex Mono", monospace',
          fontSize: 12,
          letterSpacing: ".18em",
          textTransform: "uppercase",
          color: "#24406b",
        }}
      >
        Washington DC South Mission
      </div>
      <div style={{ fontFamily: '"Spectral", Georgia, serif', fontSize: 30, fontWeight: 600, letterSpacing: "-.01em" }}>
        {title}
      </div>
      <div style={{ fontSize: 13, color: "#53606b" }}>{sub}</div>
    </div>
  );
}

function Legend() {
  return (
    <div style={{ marginTop: 14, fontSize: 11, color: "#8a95a0", fontFamily: '"IBM Plex Mono", monospace' }}>
      colour band on goal %: &lt;50 · 50–79 · 80+
    </div>
  );
}

interface BoardProps {
  weekLabel: string;
  rows: string[]; // ordered zone or area names
  grid: ZoneGrid;
  totalKey: string; // "MISSION" or the zone's UPPERCASE name
  bands: Bands;
  title: string;
}

export const Board = forwardRef<HTMLDivElement, BoardProps>(function Board(
  { weekLabel, rows, grid, totalKey, bands, title },
  ref,
) {
  const body = rows.filter((r) => r !== totalKey);
  return (
    <div ref={ref} style={wrap}>
      <Header title={title} sub={weekLabel} />
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left" }}>{title.includes("Zone") ? "Zone" : "Area"}</th>
            {KI_IDS.map((ki) => (
              <th key={ki} style={th} title={KI_NAME[ki]}>
                {KI_CODE[ki]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((name) => (
            <tr key={name}>
              <td style={rowHead}>{name}</td>
              {KI_IDS.map((ki) => (
                <Cell key={ki} c={grid[name]?.[ki]} bands={bands} />
              ))}
            </tr>
          ))}
          {grid[totalKey] && (
            <tr style={{ background: "#e5eaf2" }}>
              <td style={{ ...rowHead, fontWeight: 800, borderTop: "2px solid #c3c9bd" }}>{totalKey}</td>
              {KI_IDS.map((ki) => (
                <Cell key={ki} c={grid[totalKey]?.[ki]} bands={bands} />
              ))}
            </tr>
          )}
        </tbody>
      </table>
      <Legend />
    </div>
  );
});

export function MlcBlock({
  mlc,
  bands,
}: {
  mlc: { this: Record<number, { code: string; mission: number; mlc: number; share: number | null }> };
  bands: Bands;
}) {
  return (
    <table style={{ borderCollapse: "collapse", marginTop: 22, fontSize: 13, width: "100%" }}>
      <thead>
        <tr>
          <th style={{ ...th, textAlign: "left" }}>MLC share</th>
          {KI_IDS.map((ki) => (
            <th key={ki} style={th}>
              {KI_CODE[ki]}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style={rowHead}>Mission</td>
          {KI_IDS.map((ki) => (
            <td key={ki} style={td}>
              {mlc.this[ki]?.mission ?? 0}
            </td>
          ))}
        </tr>
        <tr>
          <td style={rowHead}>MLC areas</td>
          {KI_IDS.map((ki) => (
            <td key={ki} style={td}>
              {mlc.this[ki]?.mlc ?? 0}
            </td>
          ))}
        </tr>
        <tr style={{ background: "#e5eaf2" }}>
          <td style={{ ...rowHead, fontWeight: 700 }}>Share</td>
          {KI_IDS.map((ki) => {
            const s = mlc.this[ki]?.share ?? null;
            return (
              <td key={ki} style={{ ...td, color: band(s, bands), fontWeight: 700 }}>
                {s == null ? "–" : `${s}%`}
              </td>
            );
          })}
        </tr>
      </tbody>
    </table>
  );
}
