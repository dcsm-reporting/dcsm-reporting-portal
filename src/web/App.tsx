import { Component, type ReactNode, Suspense, lazy } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { WeekProvider, useMe } from "./lib.js";
import { ThisWeekPage } from "./pages/ThisWeek.js";

// Route-level code splitting – Recharts (Trends, Stakes) and the admin section
// are the heavy chunks; keep them off the first paint.
const ConsolePage = lazy(() => import("./pages/Console.js").then((m) => ({ default: m.ConsolePage })));
const StakesPage = lazy(() => import("./pages/Stakes.js").then((m) => ({ default: m.StakesPage })));
const FriendsPage = lazy(() => import("./pages/Friends.js").then((m) => ({ default: m.FriendsPage })));
const BaptismCheckPage = lazy(() =>
  import("./pages/BaptismCheck.js").then((m) => ({ default: m.BaptismCheckPage })),
);
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
const ReportingConfigPage = lazy(() =>
  import("./pages/admin/ReportingConfig.js").then((m) => ({ default: m.ReportingConfigPage })),
);
const AccessPage = lazy(() => import("./pages/admin/Access.js").then((m) => ({ default: m.AccessPage })));
const CrosswalkRawPage = lazy(() =>
  import("./pages/admin/CrosswalkRaw.js").then((m) => ({ default: m.CrosswalkRawPage })),
);

/** grouped: review · produce · run · configure. `admin` marks the tabs that
 *  belong to the office (the weekly checklist and structure/config); they are
 *  hidden for everyone else. */
const TABS: [string, string, boolean?][] = [
  ["/", "This Week"],
  ["/stakes", "Stakes"],
  ["/baptisms", "Baptisms"],
  ["/trends", "Trends"],
  ["/publish", "Publish"],
  ["/import", "Import"],
  ["/weekly", "Console", true],
  ["/admin", "Admin", true],
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

function WhoAmI({ user }: { user: string | null }) {
  return (
    <NavLink
      to="/settings"
      className={({ isActive }) => `pill whoami${isActive ? " active" : ""}`}
      title="Your preferences"
    >
      <span aria-hidden="true">⚙</span> {user || "Preferences"}
    </NavLink>
  );
}

export function App() {
  const me = useMe();
  const isAdmin = me?.isAdmin ?? true; // optimistic until /api/me resolves
  const tabs = TABS.filter(([, , adminOnly]) => !adminOnly || isAdmin);

  if (me && !me.authorized) {
    return (
      <div className="app">
        <header className="masthead">
          <div className="brand">
            <h1>WDCSM Reporting</h1>
            <small>Washington DC South Mission</small>
          </div>
        </header>
        <main>
          <div className="note" style={{ maxWidth: "60ch", margin: "3rem auto" }}>
            <strong>This account is not authorized for the portal.</strong>
            <p style={{ margin: ".5rem 0 0" }}>
              You are signed in as <span className="mono">{me.user}</span>. Access is limited to the
              people the mission office has listed. Ask the office to add you.
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <WeekProvider>
      <div className="app">
        <header className="masthead">
          <div className="brand">
            <h1>WDCSM Reporting</h1>
            <small>Washington DC South Mission</small>
          </div>
          <nav className="tabs">
            {tabs.map(([to, label]) => (
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
          <WhoAmI user={me?.user ?? null} />
        </header>
        <main>
          <Boundary>
            <Suspense fallback={<p className="muted">loading…</p>}>
              <Routes>
                <Route path="/" element={<ThisWeekPage />} />
                <Route path="/weekly" element={isAdmin ? <ConsolePage /> : <Navigate to="/" replace />} />
                <Route path="/month" element={<Navigate to="/?window=month" replace />} />
                <Route path="/stakes" element={<StakesPage />} />
                <Route path="/baptisms" element={<FriendsPage />} />
                <Route path="/baptisms/check" element={<BaptismCheckPage />} />
                <Route path="/friends" element={<Navigate to="/baptisms" replace />} />
                <Route path="/trends" element={<TrendsPage />} />
                <Route path="/not-reported" element={<ChasePage />} />
                <Route path="/chase" element={<Navigate to="/not-reported" replace />} />
                <Route path="/publish" element={<PublishPage />} />
                <Route path="/import" element={<ImportPage />} />
                <Route path="/data" element={<Navigate to="/admin/data" replace />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route
                  path="/admin"
                  element={isAdmin ? <AdminLayout /> : <Navigate to="/" replace />}
                >
                  <Route index element={<Navigate to="rollover" replace />} />
                  <Route path="rollover" element={<RolloverPage />} />
                  <Route path="areas" element={<AreasPage />} />
                  <Route path="recipients" element={<RecipientsPage />} />
                  <Route path="config" element={<ReportingConfigPage />} />
                  <Route path="access" element={<AccessPage />} />
                  <Route path="data" element={<DataPage />} />
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
