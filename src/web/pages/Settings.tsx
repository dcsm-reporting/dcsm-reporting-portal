import { useEffect, useState } from "react";
import { api, type PortalConfig } from "../api.js";
import { ErrorNote, Loading, PageHead, useAsync } from "../lib.js";
import { getTheme, setTheme, type Theme } from "../theme.js";

function AppearanceSection() {
  const [theme, setThemeState] = useState<Theme>(getTheme());
  const opts: [Theme, string][] = [
    ["light", "Light"],
    ["dark", "Dark"],
    ["system", "Match device"],
  ];
  return (
    <>
      <h3>Appearance</h3>
      <p className="muted" style={{ fontSize: ".85rem" }}>Stored in this browser only.</p>
      <div className="row">
        {opts.map(([t, label]) => (
          <button
            key={t}
            className={`btn${theme === t ? " primary" : ""}`}
            onClick={() => {
              setTheme(t);
              setThemeState(t);
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </>
  );
}

function AccountSection() {
  const [user, setUser] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/me")
      .then((r) => (r.ok ? (r.json() as Promise<{ user?: string }>) : null))
      .then((d) => setUser(d?.user ?? null))
      .catch(() => {});
  }, []);
  return (
    <>
      <h3>Account</h3>
      <p className="muted" style={{ fontSize: ".85rem" }}>
        {user ? (
          <>
            Signed in as <strong>{user}</strong> via Cloudflare Access. Sign-out is handled by
            Access; close the tab or clear your Access session to switch accounts.
          </>
        ) : (
          "Not signed in."
        )}
      </p>
    </>
  );
}

export function SettingsPage() {
  const cfgReq = useAsync(() => api.config(), []);
  const structReq = useAsync(() => api.structure(), []);
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    if (cfgReq.data) setCfg(cfgReq.data.config);
  }, [cfgReq.data]);

  const save = async (key: string, value: unknown) => {
    setSaved(null);
    const r = await api.setConfig(key, value);
    setCfg(r.config);
    setSaved(key);
    setTimeout(() => setSaved(null), 2500);
  };

  const move = (i: number, d: -1 | 1) => {
    if (!cfg) return;
    const arr = [...cfg.zoneOrder];
    const j = i + d;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    setCfg({ ...cfg, zoneOrder: arr });
  };

  return (
    <>
      <PageHead title="Settings" />
      <AccountSection />
      <AppearanceSection />

      <h3 style={{ marginTop: "2rem" }}>Reporting settings</h3>
      <p className="muted" style={{ maxWidth: "68ch" }}>
        Read on every request, so a change takes effect on the next page load, no deploy. Defaults
        come from the code; edits are stored in the database and apply for everyone.
      </p>

      {(cfgReq.loading || structReq.loading) && <Loading what="settings" />}
      {cfgReq.err && <ErrorNote err={cfgReq.err} />}
      {cfg && cfgReq.data && (
        <>
          <h4 style={{ marginTop: "1.4rem", fontWeight: 600 }}>
            MLC positions {saved === "mlc_positions" && <span className="chip high">saved</span>}
          </h4>
          <p className="muted" style={{ fontSize: ".85rem" }}>
            An area counts as an MLC area if a missionary in it holds one of these. Recomputed at read
            time, so a change here retro-applies to every stored week.
          </p>
          <div className="row" style={{ gap: ".4rem 1rem" }}>
            {[
              ...new Set([
                ...(structReq.data?.positionsSeen ?? []),
                ...cfgReq.data.defaults.mlcPositions,
                ...cfg.mlcPositions,
              ]),
            ]
              .sort()
              .map((p) => (
                <label key={p} className="row" style={{ gap: ".3rem" }}>
                  <input
                    type="checkbox"
                    checked={cfg.mlcPositions.includes(p)}
                    onChange={(e) =>
                      setCfg({
                        ...cfg,
                        mlcPositions: e.target.checked
                          ? [...cfg.mlcPositions, p]
                          : cfg.mlcPositions.filter((x) => x !== p),
                      })
                    }
                  />
                  <span className="mono" style={{ fontSize: ".78rem" }}>{p}</span>
                </label>
              ))}
          </div>
          <div className="row" style={{ marginTop: ".6rem" }}>
            <button className="btn primary" onClick={() => save("mlc_positions", cfg.mlcPositions)}>
              Save MLC positions
            </button>
            <button
              className="btn"
              onClick={() => setCfg({ ...cfg, mlcPositions: cfgReq.data!.defaults.mlcPositions })}
            >
              Reset to default
            </button>
          </div>

          <h4 style={{ marginTop: "1.4rem", fontWeight: 600 }}>
            Zone order {saved === "zone_order" && <span className="chip high">saved</span>}
          </h4>
          <table className="grid" style={{ maxWidth: 360 }}>
            <tbody>
              {cfg.zoneOrder.map((z, i) => (
                <tr key={z}>
                  <td>{z}</td>
                  <td style={{ width: "6rem" }}>
                    <button className="btn" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>{" "}
                    <button
                      className="btn"
                      onClick={() => move(i, 1)}
                      disabled={i === cfg.zoneOrder.length - 1}
                    >
                      ↓
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row" style={{ marginTop: ".6rem" }}>
            <button className="btn primary" onClick={() => save("zone_order", cfg.zoneOrder)}>
              Save zone order
            </button>
            <button
              className="btn"
              onClick={() => setCfg({ ...cfg, zoneOrder: cfgReq.data!.defaults.zoneOrder })}
            >
              Reset
            </button>
          </div>

          <h4 style={{ marginTop: "1.4rem", fontWeight: 600 }}>
            Zones excluded from mission totals{" "}
            {saved === "zone_exclude" && <span className="chip high">saved</span>}
          </h4>
          <div className="row" style={{ gap: ".4rem 1rem" }}>
            {[...new Set([...(structReq.data?.zones ?? []), ...cfg.zoneOrder])].map((z) => (
              <label key={z} className="row" style={{ gap: ".3rem" }}>
                <input
                  type="checkbox"
                  checked={cfg.zoneExclude.includes(z)}
                  onChange={(e) =>
                    setCfg({
                      ...cfg,
                      zoneExclude: e.target.checked
                        ? [...cfg.zoneExclude, z]
                        : cfg.zoneExclude.filter((x) => x !== z),
                    })
                  }
                />
                <span>{z}</span>
              </label>
            ))}
          </div>
          <div className="row" style={{ marginTop: ".6rem" }}>
            <button className="btn primary" onClick={() => save("zone_exclude", cfg.zoneExclude)}>
              Save exclude list
            </button>
          </div>

          <h4 style={{ marginTop: "1.4rem", fontWeight: 600 }}>
            Colour bands {saved === "bands" && <span className="chip high">saved</span>}
          </h4>
          <table className="grid" style={{ maxWidth: 420 }}>
            <tbody>
              <BandRow
                label="Goal %: amber below"
                value={cfg.bands.goalPct.low}
                set={(v) =>
                  setCfg({ ...cfg, bands: { ...cfg.bands, goalPct: { ...cfg.bands.goalPct, low: v } } })
                }
              />
              <BandRow
                label="Goal %: green at/above"
                value={cfg.bands.goalPct.mid}
                set={(v) =>
                  setCfg({ ...cfg, bands: { ...cfg.bands, goalPct: { ...cfg.bands.goalPct, mid: v } } })
                }
              />
              <BandRow
                label="MLC share %: amber below"
                value={cfg.bands.mlcShare.low}
                set={(v) =>
                  setCfg({
                    ...cfg,
                    bands: { ...cfg.bands, mlcShare: { ...cfg.bands.mlcShare, low: v } },
                  })
                }
              />
              <BandRow
                label="MLC share %: green at/above"
                value={cfg.bands.mlcShare.mid}
                set={(v) =>
                  setCfg({
                    ...cfg,
                    bands: { ...cfg.bands, mlcShare: { ...cfg.bands.mlcShare, mid: v } },
                  })
                }
              />
            </tbody>
          </table>
          <div className="row" style={{ marginTop: ".6rem" }}>
            <button className="btn primary" onClick={() => save("bands", cfg.bands)}>Save bands</button>
            <button
              className="btn"
              onClick={() => setCfg({ ...cfg, bands: cfgReq.data!.defaults.bands })}
            >
              Reset
            </button>
          </div>
        </>
      )}
    </>
  );
}

function BandRow({ label, value, set }: { label: string; value: number; set: (v: number) => void }) {
  return (
    <tr>
      <td>{label}</td>
      <td style={{ width: "6rem" }}>
        <input type="number" value={value} onChange={(e) => set(parseInt(e.target.value, 10) || 0)} />
      </td>
    </tr>
  );
}
