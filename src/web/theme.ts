/**
 * Light / dark / system theme, stored per browser in localStorage.
 *
 * "system" removes the [data-theme] attribute so the CSS falls back to
 * prefers-color-scheme; "light" / "dark" stamp the attribute to override it.
 * index.html has a tiny inline copy of applyTheme() so there's no flash on load.
 */
export type Theme = "light" | "dark" | "system";

const KEY = "dcsm-theme";

export function getTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(t: Theme): void {
  const root = document.documentElement;
  if (t === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", t);
}

export function setTheme(t: Theme): void {
  try {
    if (t === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch {
    /* private mode / storage disabled — the in-memory apply below still works */
  }
  applyTheme(t);
}
