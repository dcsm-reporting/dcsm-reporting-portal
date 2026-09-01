export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Only consulted when Cf-Access-Authenticated-User-Email is absent (local dev). */
  DEV_USER?: string;
  /** Optional extra allowlist (comma-separated emails). Access is the real gate. */
  ALLOWED_EMAILS?: string;
}

export interface Vars {
  user: string;
}
