export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Response cache — invalidated by a version counter, not TTL alone. */
  CACHE?: KVNamespace;
  /** Only consulted when Cf-Access-Authenticated-User-Email is absent (local dev). */
  DEV_USER?: string;
  /** Optional extra allowlist (comma-separated emails). Access is the real gate. */
  ALLOWED_EMAILS?: string;
  /** Bearer secret the Baptisms-sheet Apps Script presents to POST /api/friends/sync. */
  FRIENDS_SYNC_SECRET?: string;
  /** Bearer secret the Slides-deck Apps Script presents to GET /api/slides/:mode. */
  SLIDES_READ_SECRET?: string;
  /**
   * Optional, set together: verify the Cf-Access-Jwt-Assertion header against
   * the team's published keys + this app's audience tag (see src/server/auth.ts).
   */
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  PORTAL_ENV?: string;
}

export interface Vars {
  user: string;
  /** true when `admin_emails` config is empty (everyone) or lists this user. */
  isAdmin: boolean;
}
