import { NavLink, Route, Routes } from "react-router-dom";
import { WeekPicker, WeekProvider } from "./lib.js";
import { ThisWeekPage } from "./pages/ThisWeek.js";
import { MonthPage } from "./pages/Month.js";
import { StakesPage } from "./pages/Stakes.js";
import { TrendsPage } from "./pages/Trends.js";
import { ChasePage } from "./pages/Chase.js";
import { ImportPage } from "./pages/Import.js";
import { AdminPage } from "./pages/Admin.js";

const TABS: [string, string][] = [
  ["/", "This Week"],
  ["/month", "Month"],
  ["/stakes", "Stakes"],
  ["/trends", "Trends"],
  ["/chase", "Chase list"],
  ["/import", "Import"],
  ["/admin", "Admin"],
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
              <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => (isActive ? "active" : "")}>
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
            <Route path="/month" element={<MonthPage />} />
            <Route path="/stakes" element={<StakesPage />} />
            <Route path="/trends" element={<TrendsPage />} />
            <Route path="/chase" element={<ChasePage />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/admin" element={<AdminPage />} />
          </Routes>
        </main>
      </div>
    </WeekProvider>
  );
}
