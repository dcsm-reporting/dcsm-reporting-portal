import { useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api.js";
import { ErrorNote, KI_CODE, KI_IDS, Loading, useAsync, useWeek } from "../lib.js";

const COLORS = ["#24406b", "#2f6b46", "#97620f", "#9a3b34", "#5b4b8a", "#0f6b78"];
const ZONES = [
  "Alexandria", "Annandale", "Bull Run", "McLean", "Oakton",
  "Langley", "Loudoun", "Woodbridge", "Manassas", "Potomac",
];

export function TrendsPage() {
  const { week } = useWeek();
  const [scope, setScope] = useState<string>("mission");
  const [nWeeks, setNWeeks] = useState(12);
  const [visible, setVisible] = useState<Set<string>>(new Set(["NP", "BD", "SA"]));

  const mlcOnly = scope === "mlc";
  const zone = scope !== "mission" && scope !== "mlc" ? scope : null;
  const { data, err, loading } = useAsync(
    () => api.trends({ upTo: week ?? undefined, n: nWeeks, zone, mlcOnly }),
    [week, nWeeks, scope],
  );

  return (
    <>
      <h2>Trends</h2>
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
          <span className="k mono">Window</span>
          <select value={nWeeks} onChange={(e) => setNWeeks(parseInt(e.target.value, 10))}>
            {[4, 8, 12, 26, 52].map((n) => (
              <option key={n} value={n}>{n} weeks</option>
            ))}
          </select>
        </label>
        <span className="row" style={{ gap: ".3rem" }}>
          {KI_IDS.map((ki) => {
            const code = KI_CODE[ki];
            const on = visible.has(code);
            return (
              <button
                key={ki}
                className="pill"
                style={{ borderColor: on ? "var(--accent)" : undefined, color: on ? "var(--accent-ink)" : undefined }}
                onClick={() =>
                  setVisible((s) => {
                    const n = new Set(s);
                    n.has(code) ? n.delete(code) : n.add(code);
                    return n;
                  })
                }
              >
                {code}
              </button>
            );
          })}
        </span>
      </div>

      {loading && <Loading what="series" />}
      {err && <ErrorNote err={err} />}
      {data && (
        <div style={{ width: "100%", height: 420, marginTop: "1rem" }}>
          <ResponsiveContainer>
            <LineChart data={data.rows} margin={{ top: 8, right: 24, bottom: 8, left: 0 }}>
              <CartesianGrid stroke="var(--rule)" strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--ink-soft)" }} />
              <YAxis tick={{ fontSize: 11, fill: "var(--ink-soft)" }} width={44} />
              <Tooltip
                contentStyle={{
                  background: "var(--surface)",
                  border: "1px solid var(--rule-strong)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Legend />
              {KI_IDS.map((ki, i) => {
                const code = KI_CODE[ki];
                if (!visible.has(code)) return null;
                return (
                  <Line
                    key={ki}
                    type="monotone"
                    dataKey={code}
                    stroke={COLORS[i % COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </>
  );
}
