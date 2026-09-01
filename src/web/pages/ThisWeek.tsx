import { Fragment, useState } from "react";
import { api } from "../api.js";
import {
  ErrorNote,
  KI_CODE,
  KI_IDS,
  KiCells,
  KiHeadCells,
  Loading,
  bandClass,
  useAsync,
  useWeek,
} from "../lib.js";

export function ThisWeekPage() {
  const { week } = useWeek();
  const { data, err, loading } = useAsync(() => api.week(week!), [week]);
  const [open, setOpen] = useState<string | null>(null);

  if (!week) return <p className="muted">No weeks imported yet. Go to <strong>Import</strong>.</p>;
  if (loading) return <Loading what="this week" />;
  if (err) return <ErrorNote err={err} />;
  if (!data) return null;

  const zoneRows = data.zones.filter((z) => z !== "MISSION");
  const mission = data.byZone.MISSION;

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2>{data.weekLabel}</h2>
        <span className="muted mono" style={{ fontSize: ".78rem" }}>
          {data.resolve.resolvedCount} areas resolved
          {data.resolve.unmapped.length > 0 && ` · ${data.resolve.unmapped.length} unmapped`}
        </span>
      </div>

      {data.resolve.unmapped.length > 0 && (
        <div className="note warn">
          <strong>{data.resolve.unmapped.length} IMOS area(s) not in the crosswalk.</strong>{" "}
          Stake rollups will park them under “(unmapped)”. Fix in <strong>Structure → Rollover</strong>.
        </div>
      )}

      <div className="board-wrap">
        <table className="board">
          <thead>
            <tr>
              <th className="row-head">Zone</th>
              <KiHeadCells />
            </tr>
          </thead>
          <tbody>
            {zoneRows.map((z) => {
              const isOpen = open === z;
              const areas = data.byArea[z] ?? {};
              const areaNames = Object.keys(areas).filter((n) => n !== z.toUpperCase());
              return (
                <Fragment key={z}>
                  <tr className="zone-row">
                    <td className="row-head">
                      <a href="#" onClick={(e) => (e.preventDefault(), setOpen(isOpen ? null : z))}>
                        {isOpen ? "▾" : "▸"} {z}
                      </a>
                    </td>
                    <KiCells row={data.byZone[z]!} bands={data.bands.goalPct} />
                  </tr>
                  {isOpen &&
                    areaNames.map((a) => (
                      <tr key={z + a} style={{ fontSize: ".82rem" }}>
                        <td className="row-head" style={{ paddingLeft: "1.8rem" }} title={a}>
                          {a}
                        </td>
                        <KiCells row={areas[a]!} bands={data.bands.goalPct} />
                      </tr>
                    ))}
                </Fragment>
              );
            })}
            {mission && (
              <tr className="mission">
                <td className="row-head">MISSION</td>
                <KiCells row={mission} bands={data.bands.goalPct} />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h3>MLC share — this week vs last</h3>
      <div className="board-wrap">
        <table className="board">
          <thead>
            <tr>
              <th className="row-head">Indicator</th>
              <th>Mission</th>
              <th>MLC areas</th>
              <th>Share</th>
              <th>Last wk share</th>
            </tr>
          </thead>
          <tbody>
            {KI_IDS.map((ki) => {
              const t = data.mlc.this[ki]!;
              const l = data.mlc.last?.[ki] ?? null;
              return (
                <tr key={ki}>
                  <td className="row-head">{KI_CODE[ki]}</td>
                  <td>{t.mission}</td>
                  <td>{t.mlc}</td>
                  <td>
                    <span className={`pct ${bandClass(t.share, data.bands.mlcShare.low, data.bands.mlcShare.mid)}`}>
                      {t.share === null ? "–" : `${t.share}%`}
                    </span>
                  </td>
                  <td className="muted">{l && l.share !== null ? `${l.share}%` : "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: ".78rem" }}>
        Generated {new Date(data.generatedAt).toLocaleString()} · goal % bands {data.bands.goalPct.low} / {data.bands.goalPct.mid} · MLC share bands {data.bands.mlcShare.low} / {data.bands.mlcShare.mid}
      </p>
    </>
  );
}
