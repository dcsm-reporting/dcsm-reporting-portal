import { useMemo, useState } from "react";
import { api } from "../../api.js";
import { ErrorNote, Loading, useAsync, useWeek } from "../../lib.js";
import { todayIso } from "@shared/dates";
import { apportion } from "@pipeline/goals";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (p: string) => (p.length === 4 ? "Year" : MON[parseInt(p.slice(5), 10) - 1]!);

/**
 * Admin → Baptism goals. Optional monthly and annual goals for the mission and
 * each zone. Blank means no goal. Every month is editable, past ones included.
 * Zone goals are not required to add up to the mission goal; when the mission
 * cell is set, "Suggest" fills the zones from their recent share of baptisms.
 */
export function GoalsPage() {
  const { zones: liveZones } = useWeek();
  const thisYear = todayIso().slice(0, 4);
  const thisMonth = todayIso().slice(0, 7);
  const [year, setYear] = useState(thisYear);
  const data = useAsync(() => api.goals(year), [year]);
  const share = useAsync(() => api.baptismsByZone(12), []);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [suggestMonth, setSuggestMonth] = useState<string>(thisMonth);
  const [window, setWindow] = useState(3);

  const currentZones = useMemo(() => liveZones ?? [], [liveZones]);
  const formerZones = useMemo(
    () => (data.data?.zones ?? []).filter((z) => !currentZones.includes(z)).sort(),
    [data.data, currentZones],
  );

  const periods = useMemo(() => [...(data.data?.months ?? []), year], [data.data, year]);
  const stored = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of data.data?.rows ?? []) m.set(`${r.period}|${r.zone}`, r.goal);
    return m;
  }, [data.data]);

  const key = (period: string, zone: string) => `${period}|${zone}`;
  const valueOf = (period: string, zone: string): string =>
    edits[key(period, zone)] ?? (stored.has(key(period, zone)) ? String(stored.get(key(period, zone))) : "");
  const zoneSum = (period: string): number | null => {
    let sum = 0;
    let any = false;
    for (const z of [...currentZones, ...formerZones]) {
      const v = valueOf(period, z);
      if (v !== "" && !Number.isNaN(parseInt(v, 10))) {
        sum += parseInt(v, 10);
        any = true;
      }
    }
    return any ? sum : null;
  };
  const actual = (period: string, zone: string) => data.data?.actuals?.[period]?.[zone] ?? 0;
  const dirty = Object.keys(edits).length > 0;

  // ---- suggested zone goals: share of recent baptisms × the mission goal
  const missionGoalFor = (period: string): number | null => {
    const v = valueOf(period, "");
    return v !== "" && !Number.isNaN(parseInt(v, 10)) ? parseInt(v, 10) : null;
  };
  const windowMonths = useMemo(() => {
    const all = share.data?.months ?? [];
    return all.filter((m) => m < suggestMonth).slice(-window);
  }, [share.data, suggestMonth, window]);
  const suggestion = useMemo(() => {
    const g = missionGoalFor(suggestMonth);
    if (g === null || !share.data || windowMonths.length === 0) return null;
    const weights = currentZones.map((z) => {
      const row = share.data!.zones.find((x) => x.zone === z);
      return row ? windowMonths.reduce((s, m) => s + (row.counts[m] ?? 0), 0) : 0;
    });
    const total = weights.reduce((s, w) => s + w, 0);
    if (total === 0) return null;
    const parts = apportion(g, weights);
    return { goal: g, total, parts: currentZones.map((z, i) => ({ zone: z, baptisms: weights[i]!, goal: parts[i]! })) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestMonth, share.data, windowMonths, currentZones, edits, stored]);

  // The suggestions are sent to the zones first and the zones decide; they are
  // shown here and copied out, never written into the goal cells.
  const [copied, setCopied] = useState(false);
  async function copySuggestion() {
    if (!suggestion) return;
    const lines = [
      `Suggested ${monthLabel(suggestMonth)} ${year} baptism goals (mission goal ${suggestion.goal}, ` +
        `from each zone's share of baptisms ${windowMonths.map(monthLabel).join("–")}):`,
      ...suggestion.parts.map((p) => `${p.zone}: ${p.goal}`),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMsg(lines.join(" · "));
    }
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const entries = Object.entries(edits).map(([k, v]) => {
        const [period, zone] = k.split("|");
        const n = v.trim() === "" ? null : parseInt(v, 10);
        return { period: period!, zone: zone ?? "", goal: n === null || Number.isNaN(n) ? null : n };
      });
      const res = await api.setGoals(entries);
      setEdits({});
      setMsg(`Saved: ${res.written} goal${res.written === 1 ? "" : "s"} set, ${res.removed} cleared.`);
      data.reload();
    } catch (e) {
      setMsg(String((e as Error).message ?? e));
    } finally {
      setSaving(false);
    }
  }

  const years = [String(parseInt(thisYear, 10) - 1), thisYear, String(parseInt(thisYear, 10) + 1)];
  if (!years.includes(year)) years.push(year);
  const monthsOfYear = data.data?.months ?? [];

  function row(zone: string, former = false) {
    return (
      <tr key={zone || "__mission"} style={former ? { opacity: 0.75 } : undefined}>
        <td className="row-head" style={{ fontWeight: zone ? 500 : 700, whiteSpace: "nowrap" }}>
          {zone || "Mission"}
        </td>
        {periods.map((p) => {
          const v = valueOf(p, zone);
          const sum = zone === "" ? zoneSum(p) : null;
          const edited = key(p, zone) in edits;
          const explicit = zone === "" && v !== "";
          return (
            <td key={p} style={{ textAlign: "center", padding: "2px 4px" }}>
              <input
                type="number"
                min={0}
                max={9999}
                value={v}
                placeholder={sum !== null ? String(sum) : ""}
                title={
                  zone === ""
                    ? sum !== null
                      ? explicit
                        ? `Zone goals add up to ${sum}`
                        : `No mission goal set; the zone goals add up to ${sum}`
                      : undefined
                    : undefined
                }
                onChange={(e) => setEdits({ ...edits, [key(p, zone)]: e.target.value })}
                style={{
                  width: 56,
                  textAlign: "center",
                  fontWeight: zone ? 400 : 600,
                  background: edited ? "var(--warn-wash)" : undefined,
                }}
                aria-label={`${zone || "Mission"} ${p}`}
              />
              <div className="muted" style={{ fontSize: ".7rem", lineHeight: 1.2, marginTop: 2 }}>
                {actual(p, zone) || "·"}
                {zone === "" && explicit && sum !== null && sum !== parseInt(v, 10) ? (
                  <span title={`Zone goals add up to ${sum}, the mission goal is ${v}`}> Σ{sum}</span>
                ) : null}
              </div>
            </td>
          );
        })}
      </tr>
    );
  }

  return (
    <>
      <h3>Baptism goals</h3>
      <p className="muted" style={{ maxWidth: "66ch" }}>
        Optional. Leave a cell blank for no goal. Every month can be edited, past months included. Zone goals
        do not have to add up to the mission goal; when they differ, the mission cell shows the zone sum
        beside its actual. A blank mission cell reads as the zone sum. Goals appear on the Baptisms page, the
        Trends chart, the Monday deck's zone chips, and the stake report when its headline tile is on. The
        small number under each cell is the confirmed baptisms recorded for that period.
      </p>

      <div className="row" style={{ gap: ".6rem", alignItems: "center", margin: ".6rem 0 1rem", flexWrap: "wrap" }}>
        <label className="row" style={{ gap: ".4rem" }}>
          <span className="k mono">Year</span>
          <select value={year} onChange={(e) => (setEdits({}), setYear(e.target.value))}>
            {years.sort().map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>
        <button className="primary" disabled={!dirty || saving} onClick={save}>
          {saving ? "Saving…" : dirty ? `Save ${Object.keys(edits).length} change${Object.keys(edits).length === 1 ? "" : "s"}` : "Saved"}
        </button>
        {dirty && (
          <button onClick={() => setEdits({})} disabled={saving}>Discard</button>
        )}
        {msg && <span className="muted" style={{ fontSize: ".85rem" }}>{msg}</span>}
      </div>

      {data.loading && <Loading what="goals" />}
      {data.err && <ErrorNote err={data.err} />}
      {data.data && (
        <div style={{ overflowX: "auto" }}>
          <table className="grid" style={{ fontSize: ".85rem" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>{year}</th>
                {periods.map((p) => (
                  <th key={p} style={{ textAlign: "center", minWidth: 62 }}>{monthLabel(p)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {row("")}
              {currentZones.map((z) => row(z))}
            </tbody>
          </table>
          {formerZones.length > 0 && (
            <details style={{ marginTop: ".8rem" }}>
              <summary className="muted" style={{ cursor: "pointer", fontSize: ".85rem" }}>
                Former zones ({formerZones.length}): {formerZones.join(", ")}. Not reporting now; their past
                baptisms and goals are kept here.
              </summary>
              <table className="grid" style={{ fontSize: ".85rem", marginTop: ".5rem" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>Former</th>
                    {periods.map((p) => (
                      <th key={p} style={{ textAlign: "center", minWidth: 62 }}>{monthLabel(p)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>{formerZones.map((z) => row(z, true))}</tbody>
              </table>
            </details>
          )}
        </div>
      )}

      <div className="card" style={{ marginTop: "1.4rem", maxWidth: "66ch" }}>
        <div className="k">Suggest zone goals from their recent share</div>
        <p className="muted" style={{ fontSize: ".85rem", marginTop: ".3rem" }}>
          The mission's practice: each zone's share of the mission's baptisms over the last few months,
          multiplied by the mission's goal for the coming month, rounded so the zone goals add up to it. Set
          the mission goal for the month first. The suggestions go to the zones; the zones decide, and their
          decided goals are what you type into the grid above. Nothing here changes the grid.
        </p>
        <div className="row" style={{ gap: ".8rem", alignItems: "center", flexWrap: "wrap" }}>
          <label className="row" style={{ gap: ".4rem" }}>
            <span className="k mono">Month</span>
            <select value={suggestMonth} onChange={(e) => setSuggestMonth(e.target.value)}>
              {monthsOfYear.map((m) => (
                <option key={m} value={m}>{monthLabel(m)} {year}</option>
              ))}
            </select>
          </label>
          <label className="row" style={{ gap: ".4rem" }}>
            <span className="k mono">Share over</span>
            <select value={window} onChange={(e) => setWindow(parseInt(e.target.value, 10))}>
              {[2, 3, 4, 6].map((k) => (
                <option key={k} value={k}>last {k} months</option>
              ))}
            </select>
          </label>
          <button onClick={copySuggestion} disabled={!suggestion}>
            {copied ? "Copied" : "Copy for the zones"}
          </button>
          {share.loading && <span className="muted" style={{ fontSize: ".8rem" }}>loading baptism history…</span>}
          {!suggestion && !share.loading && (
            <span className="muted" style={{ fontSize: ".8rem" }}>
              {missionGoalFor(suggestMonth) === null
                ? `Enter a mission goal for ${monthLabel(suggestMonth)} first.`
                : "No confirmed baptisms in the window to base a share on."}
            </span>
          )}
        </div>
        {suggestion && (
          <table className="grid" style={{ fontSize: ".8rem", marginTop: ".8rem" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Zone</th>
                <th style={{ textAlign: "right" }}>Baptisms, {windowMonths.map(monthLabel).join("–")}</th>
                <th style={{ textAlign: "right" }}>Share</th>
                <th style={{ textAlign: "right" }}>Suggested of {suggestion.goal}</th>
              </tr>
            </thead>
            <tbody>
              {suggestion.parts.map((p) => (
                <tr key={p.zone}>
                  <td className="row-head">{p.zone}</td>
                  <td style={{ textAlign: "right" }}>{p.baptisms}</td>
                  <td style={{ textAlign: "right" }} className="mono">{Math.round((p.baptisms / suggestion.total) * 100)}%</td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>{p.goal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
