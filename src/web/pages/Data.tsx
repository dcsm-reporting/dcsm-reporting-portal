import { useState } from "react";
import { api } from "../api.js";
import { ErrorNote, Loading, useAsync } from "../lib.js";

export function DataPage() {
  const { data, err, loading } = useAsync(() => api.data(), []);
  if (loading) return <Loading what="the data log" />;
  if (err) return <ErrorNote err={err} />;
  if (!data) return null;

  const lastImport = data.imports[0];
  const lastSync = data.syncs[0];

  return (
    <>
      <h3 style={{ margin: 0 }}>Data &amp; logs</h3>
      <p className="muted" style={{ maxWidth: "70ch" }}>
        Read-only. Every raw IMOS payload is kept exactly as imported; the audit log records every
        change made in the portal.
      </p>

      <div className="cards">
        <Stat k="Weeks stored" v={data.imports.length} sub={lastImport ? `latest ${lastImport.weekStart}` : ""} />
        <Stat
          k="Last import"
          v={lastImport ? lastImport.importedAt.slice(0, 10) : "never"}
          sub={lastImport?.importedBy ?? ""}
        />
        <Stat
          k="Last sheet sync"
          v={lastSync ? lastSync.at.slice(0, 10) : "never"}
          sub={lastSync ? `${lastSync.rowsIn} rows in` : ""}
        />
        <Stat k="Audit entries" v={data.audit.length} sub="most recent shown below" />
      </div>

      <div className="note">
        <strong>Full backup.</strong> Every table as one JSON file. Keep a copy somewhere safe
        before big changes.{" "}
        <a className="btn" href={api.exportUrl} style={{ marginLeft: ".4rem" }}>
          Download full backup (JSON)
        </a>
        <div className="muted" style={{ fontSize: ".8rem", marginTop: ".4rem" }}>
          For schema-level recovery use <code>scripts/backup.sh</code> (see <code>docs/backup.md</code>).
        </div>
      </div>

      <LegacyLoader />

      <details>
        <summary>Imported weeks ({data.imports.length})</summary>
        <div className="board-wrap">
          <table className="board">
            <thead>
              <tr>
                <th className="row-head">Week</th>
                <th className="row-head">Imported</th>
                <th className="row-head">By</th>
                <th>Data points</th>
                <th className="row-head">SHA</th>
                <th className="row-head">Raw</th>
              </tr>
            </thead>
            <tbody>
              {data.imports.map((r) => (
                <tr key={r.weekStart}>
                  <td className="row-head mono">{r.weekStart} → {r.weekEnd}</td>
                  <td className="row-head mono muted">{r.importedAt.replace("T", " ").slice(0, 16)}</td>
                  <td className="row-head muted">{r.importedBy ?? "–"}</td>
                  <td>{r.nFacts}</td>
                  <td className="row-head mono muted">{r.sha}</td>
                  <td className="row-head">
                    <a className="btn" href={`/api/data/raw/${r.weekStart}`}>download</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <details>
        <summary>Baptisms sheet syncs ({data.syncs.length})</summary>
        <div className="board-wrap">
          <table className="board">
            <thead>
              <tr>
                <th className="row-head">When</th>
                <th>Rows in</th>
                <th>Upserted</th>
                <th>Deactivated</th>
                <th className="row-head">Warnings</th>
              </tr>
            </thead>
            <tbody>
              {data.syncs.map((s, i) => (
                <tr key={i}>
                  <td className="row-head mono muted">{s.at.replace("T", " ").slice(0, 16)}</td>
                  <td>{s.rowsIn}</td>
                  <td>{s.upserted}</td>
                  <td>{s.deactivated}</td>
                  <td className="row-head muted" style={{ fontSize: ".8rem" }}>
                    {s.warnings ? JSON.parse(s.warnings).length : 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <details>
        <summary>Audit log ({data.audit.length})</summary>
        <div className="board-wrap">
          <table className="board">
            <thead>
              <tr>
                <th className="row-head">When</th>
                <th className="row-head">Actor</th>
                <th className="row-head">Action</th>
                <th className="row-head">Detail</th>
              </tr>
            </thead>
            <tbody>
              {data.audit.map((a, i) => (
                <tr key={i}>
                  <td className="row-head mono muted">{a.at.replace("T", " ").slice(0, 16)}</td>
                  <td className="row-head muted">{a.actor}</td>
                  <td className="row-head mono">{a.action}</td>
                  <td className="row-head muted" style={{ fontSize: ".78rem", maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {a.detail ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
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

/** A small RFC-4180 reader: quoted fields, doubled quotes, CRLF. Header row → objects. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c !== "")) rows.push(row);
  const [hdr, ...body] = rows;
  if (!hdr) return [];
  const keys = hdr.map((h) => h.trim().replace(/^\uFEFF/, ""));
  return body.map((r) => Object.fromEntries(keys.map((k, j) => [k, (r[j] ?? "").trim()])));
}

/**
 * Loads the two Tableau history files (docs/legacy-ki-export.md). Week by
 * week so a stall loses nothing; every call is idempotent, so re-running with
 * the same file is safe.
 */
function LegacyLoader() {
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const say = (s: string) => setLog((l) => [...l.slice(-400), s]);

  async function loadWeeks(file: File) {
    setBusy(true);
    setLog([]);
    try {
      const rows = parseCsv(await file.text());
      const need = ["week_end", "area_id", "zone", "area", "np_goal", "np_actual"];
      const missing = need.filter((k) => !(k in (rows[0] ?? {})));
      if (!rows.length || missing.length) throw new Error(`not the indicator file: missing column(s) ${missing.join(", ") || "(empty file)"}`);
      const byWeek = new Map<string, Record<string, string>[]>();
      for (const r of rows) byWeek.set(r.week_end!, [...(byWeek.get(r.week_end!) ?? []), r]);
      const weeks = [...byWeek.keys()].sort();
      say(`${rows.length} rows, ${weeks.length} weeks (${weeks[0]} to ${weeks[weeks.length - 1]}). Loading…`);
      let loaded = 0, reused = 0, skipped = 0, facts = 0;
      for (const w of weeks) {
        const res = await api.legacyWeek(w, byWeek.get(w)!);
        if (res.skipped) skipped++;
        else if (res.reused) reused++;
        else {
          loaded++;
          facts += res.facts;
        }
        if ((loaded + reused + skipped) % 10 === 0) say(`… ${loaded + reused + skipped} of ${weeks.length} weeks`);
      }
      say(`Done. ${loaded} week(s) loaded (${facts} data points), ${reused} already loaded, ${skipped} left alone because an IMOS import exists for them. Reload the page to see them.`);
    } catch (e) {
      say(`Stopped: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function loadBaptisms(file: File) {
    setBusy(true);
    setLog([]);
    try {
      const rows = parseCsv(await file.text());
      const need = ["external_id", "name", "baptism_date", "zone"];
      const missing = need.filter((k) => !(k in (rows[0] ?? {})));
      if (!rows.length || missing.length) throw new Error(`not the baptism file: missing column(s) ${missing.join(", ") || "(empty file)"}`);
      say(`${rows.length} rows. Loading…`);
      const tot = { already: 0, matchedCurrent: 0, confirmedLegacy: 0, inserted: 0, skipped: 0 };
      for (let i = 0; i < rows.length; i += 250) {
        const res = await api.legacyBaptisms(rows.slice(i, i + 250));
        for (const k of Object.keys(tot) as (keyof typeof tot)[]) tot[k] += res[k];
        say(`… ${Math.min(i + 250, rows.length)} of ${rows.length}`);
      }
      say(
        `Done. ${tot.inserted} added, ${tot.confirmedLegacy} legacy record(s) confirmed, ${tot.matchedCurrent} already on the sheet or in the portal, ` +
          `${tot.already} loaded before, ${tot.skipped} without a usable date.`,
      );
    } catch (e) {
      say(`Stopped: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details style={{ marginTop: "1rem" }}>
      <summary>Load history from Tableau</summary>
      <p className="muted" style={{ maxWidth: "70ch", fontSize: ".85rem" }}>
        Two CSV files prepared as described in <code>docs/legacy-ki-export.md</code>. Weeks that already
        have an IMOS import are never overwritten. Both loads can be run again with the same file;
        nothing is duplicated.
      </p>
      <div className="row" style={{ gap: "1.2rem", flexWrap: "wrap" }}>
        <label className="field">
          <span className="k mono">Indicator rows (week_end, area_id, …)</span>
          <input type="file" accept=".csv,text/csv" disabled={busy} onChange={(e) => e.target.files?.[0] && loadWeeks(e.target.files[0])} />
        </label>
        <label className="field">
          <span className="k mono">Baptized members (external_id, name, baptism_date, …)</span>
          <input type="file" accept=".csv,text/csv" disabled={busy} onChange={(e) => e.target.files?.[0] && loadBaptisms(e.target.files[0])} />
        </label>
      </div>
      {log.length > 0 && (
        <pre className="mono" style={{ fontSize: ".78rem", whiteSpace: "pre-wrap", marginTop: ".6rem" }}>{log.join("\n")}</pre>
      )}
    </details>
  );
}
