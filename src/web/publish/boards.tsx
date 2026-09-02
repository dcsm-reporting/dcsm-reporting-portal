import { forwardRef } from "react";
import { KI_IDS, KI_CODE, KI_NAME } from "@shared/ki";
import type { KiCell, ZoneGrid } from "@pipeline/types";

type Bands = { low: number; mid: number };

/* Palette matches the Monday Slides deck (see resources/DCSM Key Indicator
   Reports - Slides Refresh.gs) so the board images read the same as the deck. */
const INK = "#1c2530";
const SOFT = "#53606b";
const FAINT = "#8a95a0";
const NAVY = "#24406b";
const RULE = "#c3c9bd";
const HAIR = "#e6e9e3";
const BAND = {
  under: { text: "#c0392b", tint: "#f9e8e6", solid: "#c0392b" },
  middle: { text: "#c4881a", tint: "#fcf2df", solid: "#c4881a" },
  upper: { text: "#1e7b45", tint: "#e6f2ea", solid: "#1e7b45" },
  none: { text: "#8a9099", tint: "#f1f3f5", solid: "#8a9099" },
};

/** Which colour band a cell falls in. An unset goal met with a positive actual
 *  reads as top tier (green), not grey — a true 0-of-0 stays grey. */
function bandFor(c: KiCell | undefined, b: Bands): keyof typeof BAND {
  if (!c) return "none";
  if (!c.goal) return c.actual > 0 ? "upper" : "none";
  const pct = c.pct ?? 0;
  if (pct >= b.mid) return "upper";
  if (pct >= b.low) return "middle";
  return "under";
}

/** The big number in a tile: the percentage, or the plain actual when there
 *  was no goal to divide by. */
function bigText(c: KiCell | undefined): string {
  if (!c) return "–";
  if (!c.goal) return c.actual > 0 ? String(c.actual) : "–";
  return `${c.pct ?? 0}%`;
}

function Tile({ c, bands, solid }: { c: KiCell | undefined; bands: Bands; solid?: boolean }) {
  const key = bandFor(c, bands);
  const pal = BAND[key];
  const sub = c ? (!c.goal ? (c.actual > 0 ? "no goal set" : "0 of 0") : `${c.actual} of ${c.goal}`) : "";
  return (
    <td
      style={{
        ...td,
        textAlign: "center",
        background: solid ? pal.solid : pal.tint,
      }}
    >
      <div
        style={{
          fontSize: 23,
          fontWeight: 700,
          lineHeight: 1.05,
          fontVariantNumeric: "tabular-nums",
          color: solid ? "#fff" : pal.text,
        }}
      >
        {bigText(c)}
      </div>
      <div style={{ fontSize: 10.5, color: solid ? "rgba(255,255,255,.85)" : FAINT, marginTop: 1 }}>
        {sub}
      </div>
    </td>
  );
}

const wrap: React.CSSProperties = {
  width: 1040,
  background: "#ffffff",
  color: INK,
  fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
  padding: "34px 40px 30px",
  boxSizing: "border-box",
};
const th: React.CSSProperties = {
  fontFamily: '"IBM Plex Mono", monospace',
  fontSize: 12,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: SOFT,
  padding: "8px 10px",
  textAlign: "center",
  borderBottom: `2px solid ${RULE}`,
  whiteSpace: "nowrap",
};
const td: React.CSSProperties = {
  padding: "9px 10px",
  textAlign: "right",
  borderBottom: `1px solid ${HAIR}`,
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
          color: NAVY,
        }}
      >
        Washington DC South Mission
      </div>
      <div
        style={{
          fontFamily: '"Spectral", Georgia, serif',
          fontSize: 30,
          fontWeight: 600,
          letterSpacing: "-.01em",
        }}
      >
        {title}
      </div>
      <div style={{ fontSize: 13, color: SOFT }}>Key Indicators of Conversion &middot; {sub}</div>
    </div>
  );
}

function Legend({ bands, share }: { bands: Bands; share?: boolean }) {
  const noun = share ? "MLC share" : "goal";
  return (
    <div
      style={{
        marginTop: 14,
        fontSize: 11,
        color: FAINT,
        fontFamily: '"IBM Plex Mono", monospace',
        display: "flex",
        gap: 14,
        alignItems: "center",
      }}
    >
      <span>{noun} %:</span>
      <Swatch c={BAND.under.solid} t={`under ${bands.low}`} />
      <Swatch c={BAND.middle.solid} t={`${bands.low}–${bands.mid}`} />
      <Swatch c={BAND.upper.solid} t={`${bands.mid}+`} />
    </div>
  );
}
function Swatch({ c, t }: { c: string; t: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 9, height: 9, background: c, display: "inline-block", borderRadius: 2 }} />
      {t}
    </span>
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
            <th style={{ ...th, textAlign: "left" }}>{title.includes("Zone") ? "Area" : "Zone"}</th>
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
                <Tile key={ki} c={grid[name]?.[ki]} bands={bands} />
              ))}
            </tr>
          ))}
          {grid[totalKey] && (
            <tr>
              <td style={{ ...rowHead, fontWeight: 800, borderTop: `2px solid ${RULE}` }}>{totalKey}</td>
              {KI_IDS.map((ki) => (
                <Tile key={ki} c={grid[totalKey]?.[ki]} bands={bands} solid />
              ))}
            </tr>
          )}
        </tbody>
      </table>
      <Legend bands={bands} />
    </div>
  );
});

type MlcRow = Record<number, { code: string; mission: number; mlc: number; share: number | null }>;

export const MlcBoard = forwardRef<
  HTMLDivElement,
  {
    weekLabel: string;
    mlc: { this: MlcRow; last: MlcRow | null; lastWeekStart: string | null };
    bands: Bands;
  }
>(function MlcBoard({ weekLabel, mlc, bands }, ref) {
  const blocks: [string, MlcRow][] = [["This week", mlc.this]];
  if (mlc.last) blocks.push(["Last week", mlc.last]);

  return (
    <div ref={ref} style={wrap}>
      <Header title="MLC Key Indicators" sub={weekLabel} />
      {blocks.map(([label, row]) => (
        <div key={label} style={{ marginBottom: 20 }}>
          <div
            style={{
              fontFamily: '"IBM Plex Mono", monospace',
              fontSize: 11,
              letterSpacing: ".12em",
              textTransform: "uppercase",
              color: SOFT,
              margin: "6px 0",
            }}
          >
            {label}
          </div>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: "left" }} />
                {KI_IDS.map((ki) => (
                  <th key={ki} style={th} title={KI_NAME[ki]}>
                    {KI_CODE[ki]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={rowHead}>Mission total</td>
                {KI_IDS.map((ki) => (
                  <td key={ki} style={{ ...td, textAlign: "center" }}>
                    {row[ki]?.mission ?? 0}
                  </td>
                ))}
              </tr>
              <tr>
                <td style={rowHead}>MLC areas</td>
                {KI_IDS.map((ki) => (
                  <td key={ki} style={{ ...td, textAlign: "center" }}>
                    {row[ki]?.mlc ?? 0}
                  </td>
                ))}
              </tr>
              <tr>
                <td style={{ ...rowHead, fontWeight: 800, borderTop: `2px solid ${RULE}` }}>MLC share</td>
                {KI_IDS.map((ki) => {
                  const s = row[ki]?.share ?? null;
                  const key = bandFor(
                    { actual: row[ki]?.mlc ?? 0, goal: row[ki]?.mission ?? 0, pct: s } as KiCell,
                    bands,
                  );
                  return (
                    <td
                      key={ki}
                      style={{
                        ...td,
                        textAlign: "center",
                        borderTop: `2px solid ${RULE}`,
                        background: BAND[key].solid,
                        color: "#fff",
                        fontWeight: 700,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {s == null ? "–" : `${s}%`}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      ))}
      <Legend bands={bands} share />
    </div>
  );
});
