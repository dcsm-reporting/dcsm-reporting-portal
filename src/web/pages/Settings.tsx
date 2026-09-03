import { useEffect, useState } from "react";
import { PageHead } from "../lib.js";
import { getTheme, setTheme, type Theme } from "../theme.js";

/** Personal, per-browser preferences. Mission-wide reporting knobs live in
 *  Admin → Reporting settings. */
export function SettingsPage() {
  return (
    <>
      <PageHead title="Your preferences" />
      <p className="muted" style={{ maxWidth: "68ch", fontSize: ".88rem" }}>
        These are personal to you and this browser. Mission-wide reporting settings (MLC positions,
        zone order, colour bands) live under <strong>Admin → Reporting settings</strong>.
      </p>
      <AccountSection />
      <AppearanceSection />
    </>
  );
}

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
