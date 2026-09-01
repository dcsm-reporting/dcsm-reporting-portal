import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { WeekPicker, WeekProvider } from "./lib.js";
import { ConsolePage } from "./pages/Console.js";
import { ThisWeekPage } from "./pages/ThisWeek.js";
import { MonthPage } from "./pages/Month.js";
import { StakesPage } from "./pages/Stakes.js";
import { TrendsPage } from "./pages/Trends.js";
import { ChasePage } from "./pages/Chase.js";
import { FriendsPage } from "./pages/Friends.js";
import { ImportPage } from "./pages/Import.js";
import { AdminLayout } from "./pages/admin/AdminLayout.js";
import { RolloverPage } from "./pages/admin/Rollover.js";
import { AreasPage } from "./pages/admin/Areas.js";
import { ConfigPage } from "./pages/admin/ConfigPage.js";
import { CrosswalkRawPage } from "./pages/admin/CrosswalkRaw.js";

const TABS: [string, string][] = [
  ["/", "This Week"],
  ["/weekly", "Weekly console"],
  ["/month", "Month"],
  ["/stakes", "Stakes"],
  ["/friends", "Friends"],
  ["/trends", "Trends"],
  ["/chase", "Chase list"],
  ["/import", "Import"],
  ["/admin", "Structure"],
];

export function App() {
  return (
    <WeekProvider>
      <div className="app">
        <header className="masthead">
          <div className="brand">
            <h1>DCSM KI Portal</h1>
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
          <WeekPicker />
        </header>
        <main>
          <Routes>
            <Route path="/" element={<ThisWeekPage />} />
            <Route path="/weekly" element={<ConsolePage />} />
            <Route path="/month" element={<MonthPage />} />
            <Route path="/stakes" element={<StakesPage />} />
            <Route path="/friends" element={<FriendsPage />} />
            <Route path="/trends" element={<TrendsPage />} />
            <Route path="/chase" element={<ChasePage />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<Navigate to="rollover" replace />} />
              <Route path="rollover" element={<RolloverPage />} />
              <Route path="areas" element={<AreasPage />} />
              <Route path="config" element={<ConfigPage />} />
              <Route path="crosswalk" element={<CrosswalkRawPage />} />
            </Route>
          </Routes>
        </main>
      </div>
    </WeekProvider>
  );
}
