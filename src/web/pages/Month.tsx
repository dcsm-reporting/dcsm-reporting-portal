import { api } from "../api.js";
import { ErrorNote, KiCells, KiHeadCells, Loading, useAsync, useWeek } from "../lib.js";

export function MonthPage() {
  const { week } = useWeek();
  const { data, err, loading } = useAsync(() => api.week(week!), [week]);
  if (!week) return <p className="muted">No weeks imported yet.</p>;
  if (loading) return <Loading what="month" />;
  if (err) return <ErrorNote err={err} />;
  if (!data) return null;

  const zones = data.zones.filter((z) => z !== "MISSION");
  return (
    <>
      <h2>{data.month.label} — Mission at a Glance</h2>
      <p className="muted mono" style={{ fontSize: ".78rem" }}>
        Sum of {data.month.window.length} weeks: {data.month.window.join(", ")}
      </p>
      <div className="board-wrap">
        <table className="board">
          <thead>
            <tr>
              <th className="row-head">Zone</th>
              <KiHeadCells />
            </tr>
          </thead>
          <tbody>
            {zones.map((z) => (
              <tr key={z}>
                <td className="row-head">{z}</td>
                <KiCells row={data.month.byZone[z]!} />
              </tr>
            ))}
            {data.month.byZone.MISSION && (
              <tr className="mission">
                <td className="row-head">MISSION</td>
                <KiCells row={data.month.byZone.MISSION} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: ".78rem" }}>
        The month total adds the four most recent stored weeks straight across. If a week is missing,
        import it on the Import page and this recomputes.
      </p>
    </>
  );
}
