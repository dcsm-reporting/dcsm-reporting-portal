import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api.js";
import { ErrorNote, KI_CODE, KI_IDS, Loading, PageHead, useAsync, useWeek } from "../lib.js";

const COLORS = ["#24406b", "#2f6b46", "#97620f", "#9a3b34", "#5b4b8a", "#0f6b78"];
const KI_CODES = KI_IDS.map((ki) => KI_CODE[ki]);
const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const fmtMonth = (m: string) => {
  const [y, mm] = m.split("-").map((n) => parseInt(n, 10));
  return `${MONTH_ABBR[mm! - 1]} ${y}`;
};

export function TrendsPage() {
  // zones come from stored data (configured order), so a transfer that adds
  // or renames a zone shows up here without a code change
  const { week, zones: ZONES } = useWeek();
  const [scope, setScope] = useState<string>("mission");
  const [nWeeks, setNWeeks] = useState(12);
  const [measure, setMeasure] = useState<"actual" | "pct">("actual");
  const [visible, setVisible] = useState<Set<string>>(new Set(KI_CODES));

  const mlcOnly = scope === "mlc";
  const zone = scope !== "mission" && scope !== "mlc" ? scope : null;
  const { data, err, loading } = useAsync(
    () => api.trends({ upTo: week ?? undefined, n: nWeeks, zone, mlcOnly }),
    [week, nWeeks, scope],
  );

  const chartData = useMemo(() => {
    const rows = data?.rows ?? [];
    const goals = data?.goals ?? [];
    return rows.map((row, i) => {
      const g = goals[i];
      const point: Record<string, number | string | null> = { label: row.label };
      for (const code of KI_CODES) {
        const a = row[code as "NP"];
        if (measure === "pct") {
          const goal = g ? g[code as "NP"] : 0;
          point[code] = goal > 0 ? Math.round((a / goal) * 100) : null;
        } else {
          point[code] = a;
        }
      }
      return point;
    });
  }, [data, measure]);

  const toggle = (code: string) =>
    setVisible((s) => {
      const n = new Set(s);
      n.has(code) ? n.delete(code) : n.add(code);
      return n;
    });

  return (
    <>
      <PageHead title="Trends" />
      <div className="row">
        <label className="field" style={{ margin: 0 }}>
          <span className="k mono">Scope</span>
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="mission">Whole mission</option>
            <option value="mlc">MLC areas only</option>
            <optgroup label="Zone">
              {ZONES.map((z) => (
                <option key={z} value={z}>{z}</option>
              ))}
            </optgroup>
          </select>
        </label>
        <label className="field" style={{ margin: 0 }}>
          <span className="k mono">Measure</span>
          <select value={measure} onChange={(e) => setMeasure(e.target.value as typeof measure)}>
            <option value="actual">Actual count</option>
            <option value="pct">% of goal</option>
          </select>
        </label>
        <label className="field" style={{ margin: 0 }}>
          <span className="k mono">Window</span>
          <select value={nWeeks} onChange={(e) => setNWeeks(parseInt(e.target.value, 10))}>
            {[4, 8, 12, 26, 52, 104, 156].map((n) => (
              <option key={n} value={n}>{n} weeks</option>
            ))}
          </select>
        </label>
        <span className="row" style={{ gap: ".3rem" }}>
          {KI_CODES.map((code) => {
            const on = visible.has(code);
            return (
              <button
                key={code}
                className="pill"
                style={{ borderColor: on ? "var(--accent)" : undefined, color: on ? "var(--accent-ink)" : undefined }}
                onClick={() => toggle(code)}
              >
                {code}
              </button>
            );
          })}
        </span>
      </div>

      {loading && <Loading what="the series" />}
      {err && <ErrorNote err={err} />}
      {data && (
        <div style={{ width: "100%", height: 420, marginTop: "1rem" }}>
          <ResponsiveContainer>
            <LineChart data={chartData} margin={{ top: 8, right: 62, bottom: 8, left: 0 }}>
              <CartesianGrid stroke="var(--rule)" strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--ink-soft)" }} />
              <YAxis
                tick={{ fontSize: 11, fill: "var(--ink-soft)" }}
                width={44}
                unit={measure === "pct" ? "%" : undefined}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--surface)",
                  border: "1px solid var(--rule-strong)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(v: number) => (measure === "pct" ? `${v}%` : v)}
              />
              <Legend />
              {measure === "pct" && (
                <ReferenceLine
                  y={100}
                  stroke="var(--ink-soft)"
                  strokeDasharray="4 4"
                  label={{ value: "on target", position: "right", fontSize: 10, fill: "var(--ink-soft)" }}
                />
              )}
              {KI_CODES.map((code, i) => {
                if (!visible.has(code)) return null;
                return (
                  <Line
                    key={code}
                    type="monotone"
                    dataKey={code}
                    stroke={COLORS[i % COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {data && measure === "pct" && (
        <p className="muted" style={{ fontSize: ".8rem" }}>
          Each line is that week’s actual as a percentage of that week’s goal. 100% is on target.
          Weeks where the goal was 0 are skipped.
        </p>
      )}

      <MonthlyBaptisms />
      <BaptismsByZone />
    </>
  );
}

function MonthlyBaptisms() {
  const { data, err, loading } = useAsync(() => api.monthlyBaptisms(6), []);
  const rows = useMemo(
    () =>
      (data?.months ?? []).map((m) => ({
        label: fmtMonth(m.month),
        confirmed: m.confirmed,
        unverified: m.unverified,
        goal: m.goal ?? null,
      })),
    [data],
  );
  const hasUnverified = rows.some((r) => r.unverified > 0);
  const hasGoal = rows.some((r) => r.goal !== null);

  return (
    <>
      <h3 style={{ marginTop: "2.4rem" }}>Baptisms, last 6 months</h3>
      {loading && <Loading what="baptism counts" />}
      {err && <ErrorNote err={err} />}
      {data && (
        <div style={{ width: "100%", height: 260 }}>
          <ResponsiveContainer>
            <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="var(--rule)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--ink-soft)" }} />
              <YAxis tick={{ fontSize: 11, fill: "var(--ink-soft)" }} width={36} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  background: "var(--surface)",
                  border: "1px solid var(--rule-strong)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              {(hasUnverified || hasGoal) && <Legend />}
              <Bar dataKey="confirmed" name="Confirmed" stackId="b" fill="var(--accent)" radius={hasUnverified ? [0, 0, 0, 0] : [3, 3, 0, 0]}>
                {rows.map((_, i) => (
                  <Cell key={i} />
                ))}
              </Bar>
              {hasUnverified && (
                <Bar dataKey="unverified" name="Unverified (legacy)" stackId="b" fill="var(--rule-strong)" radius={[3, 3, 0, 0]} />
              )}
              {hasGoal && (
                <Line
                  type="monotone"
                  dataKey="goal"
                  name="Goal"
                  stroke="#d97706"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  dot={{ r: 4, fill: "#fff", stroke: "#d97706", strokeWidth: 2 }}
                  activeDot={{ r: 5, fill: "#d97706" }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="muted" style={{ fontSize: ".8rem" }}>
        Named completed baptisms by the month of the baptism date, from the Baptisms (MLC) sheet and
        portal records.{hasGoal ? " The dashed line is the mission goal (Admin → Baptism goals)." : ""}
      </p>
    </>
  );
}

/**
 * Who the baptisms came from. The last column is each zone's share of the
 * mission total over the window, which is what the mission multiplies by the
 * next month's goal to suggest zone goals (Admin → Baptism goals).
 */
function BaptismsByZone() {
  const [n, setN] = useState(6);
  const { data, err, loading } = useAsync(() => api.baptismsByZone(n), [n]);
  const maxShare = Math.max(0.01, ...(data?.zones ?? []).map((z) => z.share));
  return (
    <>
      <div className="row" style={{ alignItems: "baseline", gap: "1rem", marginTop: "2.4rem" }}>
        <h3 style={{ margin: 0 }}>Baptisms by zone</h3>
        <select value={n} onChange={(e) => setN(parseInt(e.target.value, 10))} aria-label="Months">
          {[3, 6, 12].map((k) => (
            <option key={k} value={k}>last {k} months</option>
          ))}
        </select>
      </div>
      {loading && <Loading what="baptisms by zone" />}
      {err && <ErrorNote err={err} />}
      {data && data.mission.total === 0 && <p className="muted">No confirmed baptisms in this window.</p>}
      {data && data.mission.total > 0 && (
        <div style={{ overflowX: "auto", marginTop: ".6rem" }}>
          <table className="grid" style={{ fontSize: ".85rem" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Zone</th>
                {data.months.map((m) => (
                  <th key={m} style={{ textAlign: "right" }}>{fmtMonth(m)}</th>
                ))}
                <th style={{ textAlign: "right" }}>Total</th>
                <th style={{ textAlign: "left", minWidth: 160 }}>Share of mission</th>
              </tr>
            </thead>
            <tbody>
              {data.zones.map((z) => (
                <tr key={z.zone}>
                  <td className="row-head">{z.zone}</td>
                  {data.months.map((m) => (
                    <td key={m} style={{ textAlign: "right" }} className={z.counts[m] ? "" : "muted"}>
                      {z.counts[m] || "·"}
                    </td>
                  ))}
                  <td style={{ textAlign: "right", fontWeight: 600 }}>{z.total}</td>
                  <td>
                    <div className="row" style={{ gap: ".5rem", alignItems: "center" }}>
                      <div
                        style={{
                          height: 8,
                          width: `${Math.round((z.share / maxShare) * 110)}px`,
                          background: "var(--accent)",
                          borderRadius: 4,
                          opacity: 0.85,
                        }}
                      />
                      <span className="mono" style={{ fontSize: ".78rem" }}>{Math.round(z.share * 100)}%</span>
                    </div>
                  </td>
                </tr>
              ))}
              <tr>
                <td className="row-head" style={{ fontWeight: 700 }}>Mission</td>
                {data.months.map((m) => (
                  <td key={m} style={{ textAlign: "right", fontWeight: 600 }}>{data.mission.counts[m] || "·"}</td>
                ))}
                <td style={{ textAlign: "right", fontWeight: 700 }}>{data.mission.total}</td>
                <td className="muted mono" style={{ fontSize: ".78rem" }}>100%</td>
              </tr>
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: ".8rem" }}>
            Confirmed baptisms by the zone on the record at the time. Share is over the whole window. The
            suggested zone goals under Admin → Baptism goals multiply this share by the mission's goal.
          </p>
        </div>
      )}
    </>
  );
}
