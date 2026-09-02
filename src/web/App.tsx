import { Component, type ReactNode, Suspense, lazy, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { WeekProvider } from "./lib.js";
import { ThisWeekPage } from "./pages/ThisWeek.js";

// Route-level code splitting – Recharts (Trends, Stakes) and the admin section
// are the heavy chunks; keep them off the first paint.
const ConsolePage = lazy(() => import("./pages/Console.js").then((m) => ({ default: m.ConsolePage })));
const StakesPage = lazy(() => import("./pages/Stakes.js").then((m) => ({ default: m.StakesPage })));
const FriendsPage = lazy(() => import("./pages/Friends.js").then((m) => ({ default: m.FriendsPage })));
const TrendsPage = lazy(() => import("./pages/Trends.js").then((m) => ({ default: m.TrendsPage })));
const ChasePage = lazy(() => import("./pages/Chase.js").then((m) => ({ default: m.ChasePage })));
const ImportPage = lazy(() => import("./pages/Import.js").then((m) => ({ default: m.ImportPage })));
const PublishPage = lazy(() => import("./pages/Publish.js").then((m) => ({ default: m.PublishPage })));
const DataPage = lazy(() => import("./pages/Data.js").then((m) => ({ default: m.DataPage })));
const SettingsPage = lazy(() => import("./pages/Settings.js").then((m) => ({ default: m.SettingsPage })));
const AdminLayout = lazy(() => import("./pages/admin/AdminLayout.js").then((m) => ({ default: m.AdminLayout })));
const RolloverPage = lazy(() => import("./pages/admin/Rollover.js").then((m) => ({ default: m.RolloverPage })));
const AreasPage = lazy(() => import("./pages/admin/Areas.js").then((m) => ({ default: m.AreasPage })));
const RecipientsPage = lazy(() => import("./pages/admin/Recipients.js").then((m) => ({ default: m.RecipientsPage })));
const CrosswalkRawPage = lazy(() =>
  import("./pages/admin/CrosswalkRaw.js").then((m) => ({ default: m.CrosswalkRawPage })),
);

/** grouped: review · produce · run · configure */
const TABS: [string, string][] = [
  ["/", "This Week"],
  ["/stakes", "Stakes"],
  ["/baptisms", "Baptisms"],
  ["/trends", "Trends"],
  ["/publish", "Publish"],
  ["/import", "Import"],
  ["/weekly", "Console"],
  ["/admin", "Structure"],
];

class Boundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  override state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) {
    return { err };
  }
  override render() {
    if (this.state.err) {
      return (
        <div className="note stop" style={{ margin: "2rem" }}>
          <strong>Something broke on this page.</strong> {String(this.state.err.message)}
          <div style={{ marginTop: ".6rem" }}>
            <button className="btn" onClick={() => this.setState({ err: null })}>
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function WhoAmI() {
  const [user, setUser] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/me")
      .then((r) => (r.ok ? (r.json() as Promise<{ user?: string }>) : null))
      .then((d) => d?.user && setUser(d.user))
      .catch(() => {});
  }, []);
  return (
    <NavLink
      to="/settings"
      className={({ isActive }) => `pill whoami${isActive ? " active" : ""}`}
      title="Settings"
    >
      <span aria-hidden="true">⚙</span> {user ?? "Settings"}
    </NavLink>
  );
}

export function App() {
  return (
    <WeekProvider>
      <div className="app">
        <header className="masthead">
          <div className="brand">
            <h1>DCSM Reporting</h1>
            <small>Washington DC South Mission</small>
          </div>
          <nav className="tabs">
            {TABS.map(([to, label]) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                className={({ isActive }) => (isActive ? "active" : "")}
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <span className="spacer" />
          <WhoAmI />
        </header>
        <main>
          <Boundary>
            <Suspense fallback={<p className="muted">loading…</p>}>
              <Routes>
                <Route path="/" element={<ThisWeekPage />} />
                <Route path="/weekly" element={<ConsolePage />} />
                <Route path="/month" element={<Navigate to="/?window=month" replace />} />
                <Route path="/stakes" element={<StakesPage />} />
                <Route path="/baptisms" element={<FriendsPage />} />
                <Route path="/friends" element={<Navigate to="/baptisms" replace />} />
                <Route path="/trends" element={<TrendsPage />} />
                <Route path="/not-reported" element={<ChasePage />} />
                <Route path="/chase" element={<Navigate to="/not-reported" replace />} />
                <Route path="/publish" element={<PublishPage />} />
                <Route path="/import" element={<ImportPage />} />
                <Route path="/data" element={<Navigate to="/admin/data" replace />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/admin" element={<AdminLayout />}>
                  <Route index element={<Navigate to="rollover" replace />} />
                  <Route path="rollover" element={<RolloverPage />} />
                  <Route path="areas" element={<AreasPage />} />
                  <Route path="recipients" element={<RecipientsPage />} />
                  <Route path="data" element={<DataPage />} />
                  <Route path="config" element={<Navigate to="/settings" replace />} />
                  <Route path="crosswalk" element={<CrosswalkRawPage />} />
                </Route>
              </Routes>
            </Suspense>
          </Boundary>
        </main>
      </div>
    </WeekProvider>
  );
}
