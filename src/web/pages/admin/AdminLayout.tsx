import { NavLink, Outlet } from "react-router-dom";

const SUB: [string, string][] = [
  ["/admin/rollover", "Rollover"],
  ["/admin/areas", "Areas & wards"],
  ["/admin/config", "Config"],
  ["/admin/crosswalk", "Crosswalk (raw)"],
];

export function AdminLayout() {
  return (
    <>
      <h2>Structure &amp; admin</h2>
      <nav className="subnav">
        {SUB.map(([to, label]) => (
          <NavLink key={to} to={to} className={({ isActive }) => (isActive ? "active" : "")}>
            {label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </>
  );
}
