import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type ConsoleStep } from "../api.js";
import { ErrorNote, Loading, PageHead, useAsync } from "../lib.js";

const MARK: Record<string, { sym: string; cls: string }> = {
  done: { sym: "✓", cls: "hi" },
  attention: { sym: "!", cls: "mid" },
  todo: { sym: "○", cls: "na" },
};

const LINK_FOR: Record<string, string> = {
  import: "/import",
  crosswalk: "/admin/rollover",
  rollover: "/admin/rollover",
  chase: "/not-reported",
  friends: "/baptisms",
  overdue: "/baptisms",
  reconcile: "/baptisms",
  boards: "/publish",
  stakes: "/publish",
};

/** A measurable step that reads "done" from live data counts as checked. */
const isChecked = (s: ConsoleStep, override: Record<string, boolean>): boolean =>
  s.state === "done" ? true : (override[s.id] ?? !!s.checked);

export function ConsolePage() {
  const { data, err, loading, reload } = useAsync(() => api.console(), []);
  const [override, setOverride] = useState<Record<string, boolean>>({});

  if (loading) return <Loading what="the weekly console" />;
  if (err) return <ErrorNote err={err} />;
  if (!data) return null;

  if (data.weeksStored === 0) {
    return (
      <>
        <h2>Weekly console</h2>
        <div className="note">
          Nothing imported yet. Start on the <Link to="/import">Import</Link> page.
        </div>
      </>
    );
  }

  const attention = data.steps.filter(
    (s) => s.state === "attention" && !isChecked(s, override),
  );
  // optimistic: flip locally now, persist in the background, revert on failure
  const check = (id: string, checked: boolean) => {
    setOverride((o) => ({ ...o, [id]: checked }));
    api.checkStep(id, checked).catch(() => setOverride((o) => ({ ...o, [id]: !checked })));
  };

  return (
    <>
      <PageHead title={`Weekly console: ${data.latestLabel}`}>
        <button className="btn" onClick={reload}>Refresh</button>
      </PageHead>

      <div className="cards">
        <Stat k="Weeks stored" v={data.weeksStored} sub={data.range ? `${data.range.first} → ${data.range.last}` : ""} />
        <Stat k="Zones" v={data.counts?.zones ?? "–"} />
        <Stat k="Areas resolved" v={data.counts?.areasResolved ?? "–"} sub={data.counts?.areasUnmapped ? `${data.counts.areasUnmapped} unmapped` : "all mapped"} />
        <Stat k="Stakes" v={data.counts?.stakes ?? "–"} />
        <Stat k="Not reported" v={data.counts?.chase ?? "–"} sub={data.counts?.chase ? "still out" : "all reported"} />
        {data.friends && (
          <Stat
            k="Baptisms synced"
            v={data.friends.syncAgeHours === null ? "never" : `${data.friends.syncAgeHours} h ago`}
            sub={`${data.friends.onDate} on date · ${data.friends.baptizedThisMonth} baptized this month`}
          />
        )}
        {data.friends && data.friends.overdueCount > 0 && (
          <Stat
            k="Baptisms overdue"
            v={data.friends.overdueCount}
            sub="past date, not marked"
          />
        )}
        {data.reconcile && (
          <Stat
            k={`Reconcile ${data.reconcile.month}`}
            v={data.reconcile.gap > 0 ? `+${data.reconcile.gap}` : data.reconcile.gap}
            sub={data.reconcile.stakesWithGap > 0 ? `${data.reconcile.stakesWithGap} stake gap(s)` : "matches Portal"}
          />
        )}
      </div>

      {attention.length > 0 && (
        <div className="note warn">
          <strong>
            {attention.length} thing{attention.length > 1 ? "s" : ""}{" "}
            {attention.length > 1 ? "need" : "needs"} attention:
          </strong>{" "}
          {attention.map((s) => s.label).join(" · ")}
        </div>
      )}

      <h3>This week’s checklist</h3>
      <p className="muted" style={{ fontSize: ".82rem", marginTop: "-.3rem" }}>
        Measurable steps tick themselves from live data. Tick the rest as you finish them; the list
        resets when the next week is imported.
      </p>
      <ol className="steps checklist">
        {data.steps.map((s) => {
          const m = MARK[s.state]!;
          const to = LINK_FOR[s.id];
          const done = isChecked(s, override);
          const auto = s.state === "done";
          return (
            <li key={s.id} className={done ? "checked" : ""}>
              <input
                type="checkbox"
                checked={done}
                disabled={auto}
                onChange={(e) => check(s.id, e.target.checked)}
                title={auto ? "Done automatically" : "Mark done for this week"}
              />
              <span>
                <b>{to ? <Link to={to}>{s.label}</Link> : s.label}</b>
                {!done && (
                  <span className={`pct ${m.cls}`} style={{ marginLeft: ".5rem", fontSize: ".7rem" }}>
                    {m.sym} {s.state}
                  </span>
                )}
                <span className="hint"> {s.detail}</span>
                {done && !auto && s.state === "attention" && (
                  <span className="hint" style={{ color: "var(--band-mid)" }}> (still flagged)</span>
                )}
              </span>
            </li>
          );
        })}
      </ol>

      <h3>Jump to</h3>
      <div className="row">
        <Link className="btn" to="/import">Import</Link>
        <Link className="btn" to="/">This Week</Link>
        <Link className="btn" to="/not-reported">Not reported</Link>
        <Link className="btn" to="/stakes">Stakes</Link>
        <Link className="btn" to="/publish">Publish</Link>
        <Link className="btn" to="/admin/rollover">Structure</Link>
      </div>
    </>
  );
}

function Stat({ k, v, sub }: { k: string; v: React.ReactNode; sub?: string }) {
  return (
    <div className="card">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}
