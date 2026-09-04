/**
 * DCSM KI Portal — Cloudflare Worker entry.
 *
 * Serves /api/* (Hono) and falls back to the built SPA for everything else.
 * Auth in production is Cloudflare Access, which injects
 * `Cf-Access-Authenticated-User-Email`; locally DEV_USER stands in.
 */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import areaKeyCsv from "../../resources/area-to-ward-key.csv";
import unitsCsv from "../../resources/units.csv";
import { isWeeklyPayload, load, normalize, ValidationError } from "../pipeline/readImos.js";
import { loadAreaKey, seed } from "../pipeline/crosswalkSeed.js";
import { resolveWeek } from "../pipeline/resolve.js";
import type { Env, Vars } from "./env.js";
import { CONFIG_DEFAULTS, CONFIG_KEYS, loadConfig, validateConfigValue } from "./config.js";
import { bumpData, bumpFriends, cached } from "./cache.js";
import { accessMode, verifyAccessJwt } from "./auth.js";
import { isIsoDate, lastCompleteWeekOf, missingMondays, todayIso } from "../shared/dates.js";
import {
  addWard,
  attachArea,
  audit,
  clearNotReportedAck,
  closeMapping,
  closeWard,
  createCanonicalArea,
  deletePortalFriend,
  setNotReportedAck,
  getAreaWardRows,
  getAuditLog,
  getCanonicalRows,
  getCrosswalkRows,
  getFriendSyncLog,
  getImportLog,
  getRawPayload,
  getStructure,
  loadFacts,
  moveWardToStake,
  renameCanonical,
  renameStake,
  renameWard,
  retireWard,
  seedCrosswalk,
  setCanonicalRetired,
  setConfig,
  storeImport,
  weeksAvailable,
} from "./db.js";
import {
  applyRollover,
  buildChase,
  buildConsole,
  buildRollover,
  buildStakeView,
  buildTrends,
  buildWeekView,
  describeStructureChange,
  weekLabel,
} from "./service.js";
import {
  correctBaptism,
  friendsByStake,
  friendsSummary,
  listFriends,
  monthlyBaptisms,
  baptismsByZone,
  recordBaptism,
  syncFriends,
  type SheetRow,
} from "./friends.js";
import { buildReconcile } from "./reconcile.js";
import { buildPublish } from "./publish.js";
import { buildSlides } from "./slides.js";
import { goalsForMonths, goalsView, progressFor, setGoalRows, type GoalEntry } from "./goals.js";
import { loadLegacyBaptisms, storeLegacyWeek, type LegacyAreaRow, type LegacyBaptismRow } from "./legacy.js";
import { getConfig, getStakeRecipients, setConsoleCheck, upsertStakeRecipient } from "./db.js";
import { DEFAULT_EMAIL_TEMPLATE, type EmailTemplate } from "../shared/emailTemplate.js";
import stakeRecipientsSeed from "../../resources/stake_recipients.json";

/** Parsed once — the Area To Ward Key + the unit directory are bundled as text. */
const areaKey = loadAreaKey(areaKeyCsv, unitsCsv);

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

/**
 * Who may use the portal at all, and who may administer it. Both lists live
 * in config. Empty `admin_emails` = every user is an admin (no lock-out risk
 * on first setup). Empty `viewer_emails` = everyone Cloudflare Access lets in
 * (the mission's email domains) may view; a non-empty list restricts viewing
 * to those addresses plus the admins. One query for both.
 */
async function computeAccess(
  db: D1Database,
  email: string,
): Promise<{ isAdmin: boolean; isViewer: boolean }> {
  const { results } = await db
    .prepare("SELECT key, value_json FROM config WHERE key IN ('admin_emails', 'viewer_emails')")
    .all<{ key: string; value_json: string }>();
  const lists: Record<string, string[]> = {};
  for (const r of results ?? []) {
    try {
      const v = JSON.parse(r.value_json);
      lists[r.key] = Array.isArray(v) ? v.map((s: unknown) => String(s).trim().toLowerCase()) : [];
    } catch {
      lists[r.key] = [];
    }
  }
  const me = email.toLowerCase();
  const admins = lists.admin_emails ?? [];
  const viewers = lists.viewer_emails ?? [];
  const isAdmin = admins.length === 0 || admins.includes(me);
  const isViewer = isAdmin || viewers.length === 0 || viewers.includes(me);
  return { isAdmin, isViewer };
}

/** Path prefixes that change mission structure/config — admin-only. Weekly
 *  workflow (import, friends record, chase ack, publish, all GETs) stays open
 *  to any authenticated user. The full-database export is the one GET that is
 *  admin-only: it is the whole system in one file. */
const ADMIN_WRITE_PREFIXES = [
  "/api/config",
  "/api/crosswalk",
  "/api/seed",
  "/api/stake/",
  "/api/ward/",
  "/api/recipients",
  "/api/admins",
  "/api/goals",
];
function needsAdmin(method: string, path: string): boolean {
  if (path === "/api/export") return true;
  if (path === "/api/import/legacy" || path === "/api/friends/legacy") return true; // history loads
  if (path.startsWith("/api/data/raw/")) return true; // raw IMOS payloads carry every missionary's name
  if (method === "GET" || method === "HEAD") return false;
  if (/^\/api\/rollover\/[^/]+\/apply$/.test(path)) return true;
  if (path === "/api/console/check") return true; // the office's checklist
  return ADMIN_WRITE_PREFIXES.some((p) => path.startsWith(p));
}

// --- auth ---------------------------------------------------------------
app.use("/api/*", async (c, next) => {
  // health check, the sheet-sync webhook, and the slides feed do their own thing
  if (
    c.req.path === "/api/health" ||
    c.req.path === "/api/friends/sync" ||
    c.req.path.startsWith("/api/slides/")
  )
    return next();
  const headerEmail =
    c.req.header("Cf-Access-Authenticated-User-Email") ||
    c.req.header("cf-access-authenticated-user-email");

  // Optional signed-token check (see auth.ts). When configured, the header
  // alone is not enough: the token must verify and its email must match.
  let email: string | undefined = headerEmail || c.env.DEV_USER;
  const mode = accessMode(c.env);
  if (mode === "misconfigured") {
    throw new HTTPException(500, {
      message: "ACCESS_TEAM_DOMAIN and ACCESS_AUD must be set together (or neither)",
    });
  }
  if (mode === "on") {
    const token = c.req.header("Cf-Access-Jwt-Assertion") || "";
    if (!token) throw new HTTPException(401, { message: "not authenticated (no Access token)" });
    try {
      const claims = await verifyAccessJwt(token, c.env);
      email = claims.email;
    } catch (e) {
      throw new HTTPException(401, { message: `not authenticated: ${(e as Error).message}` });
    }
    if (headerEmail && headerEmail.toLowerCase() !== email.toLowerCase()) {
      throw new HTTPException(401, { message: "not authenticated (identity mismatch)" });
    }
  }
  if (!email) throw new HTTPException(401, { message: "not authenticated" });
  if (c.env.ALLOWED_EMAILS) {
    const ok = c.env.ALLOWED_EMAILS.split(",").map((s) => s.trim().toLowerCase());
    if (!ok.includes(email.toLowerCase())) throw new HTTPException(403, { message: "not allowed" });
  }
  c.set("user", email);
  const { isAdmin, isViewer } = await computeAccess(c.env.DB, email);
  c.set("isAdmin", isAdmin);
  if (!isViewer) {
    // /api/me still answers so the page can say why; everything else is closed
    if (c.req.path === "/api/me") return c.json({ user: email, isAdmin: false, authorized: false });
    throw new HTTPException(403, { message: "this account is not authorized for the portal" });
  }
  if (!isAdmin && needsAdmin(c.req.method, c.req.path)) {
    throw new HTTPException(403, { message: "admin access required" });
  }
  await next();
});

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  if (err instanceof ValidationError) return c.json({ error: err.message, kind: "validation" }, 422);
  console.error(err);
  return c.json({ error: String((err as Error)?.message ?? err) }, 500);
});

// --- meta -------------------------------------------------------------
app.get("/api/health", (c) => c.json({ ok: true }));
app.get("/api/me", (c) => c.json({ user: c.get("user"), isAdmin: c.get("isAdmin"), authorized: true }));

const cleanEmails = (v: unknown) => [
  ...new Set(
    (Array.isArray(v) ? v : [])
      .map((s) => String(s).trim().toLowerCase())
      .filter((s) => s.includes("@")),
  ),
];

/** The admin and viewer allowlists. Empty admins ⇒ everyone is an admin;
 *  empty viewers ⇒ everyone Access lets in may view. */
app.get("/api/admins", async (c) =>
  c.json({
    admins: await getConfig<string[]>(c.env.DB, "admin_emails", []),
    viewers: await getConfig<string[]>(c.env.DB, "viewer_emails", []),
  }),
);
app.post("/api/admins", async (c) => {
  const b = await c.req.json<{ admins?: string[]; viewers?: string[] }>();
  const me = c.get("user").toLowerCase();
  if (b.admins !== undefined) {
    const list = cleanEmails(b.admins);
    // guard against locking everyone out: a non-empty list must include the setter
    if (list.length > 0 && !list.includes(me)) {
      throw new HTTPException(400, {
        message: "the admin list must include your own address, or you would lock yourself out",
      });
    }
    await setConfig(c.env.DB, "admin_emails", list);
    await audit(c.env.DB, c.get("user"), "admins.set", { count: list.length });
  }
  if (b.viewers !== undefined) {
    const list = cleanEmails(b.viewers);
    await setConfig(c.env.DB, "viewer_emails", list);
    await audit(c.env.DB, c.get("user"), "viewers.set", { count: list.length });
  }
  await bumpData(c.env);
  return c.json({
    ok: true,
    admins: await getConfig<string[]>(c.env.DB, "admin_emails", []),
    viewers: await getConfig<string[]>(c.env.DB, "viewer_emails", []),
  });
});

app.get("/api/weeks", async (c) => {
  // the date is in the key so "expected latest week" rolls over on its own
  const today = todayIso();
  return c.json(
    await cached(c.env, `weeks:v2:${today}`, "ki", async () => {
      const [weeks, cfg] = await Promise.all([weeksAvailable(c.env.DB), loadConfig(c.env.DB)]);
      const zoneRows = await c.env.DB.prepare(
        "SELECT DISTINCT imos_zone_name AS z FROM ki_fact WHERE imos_zone_name <> ''",
      ).all<{ z: string }>();
      const seen = new Set((zoneRows.results ?? []).map((r) => r.z));
      const zones = [
        ...cfg.zoneOrder.filter((z) => seen.has(z)),
        ...[...seen].filter((z) => !cfg.zoneOrder.includes(z)).sort(),
      ].filter((z) => !cfg.zoneExclude.includes(z));
      const latest = weeks[weeks.length - 1] ?? null;
      return {
        weeks: weeks.map((w) => ({ weekStart: w, weekLabel: weekLabel(w) })),
        latest,
        /** the Monday of the most recent complete Mon–Sun week, mission tz */
        expectedLatest: lastCompleteWeekOf(today).monday,
        missing: missingMondays(weeks),
        /** every zone seen in stored data, in the configured order, excludes dropped */
        zones,
      };
    }),
  );
});

// --- import ---------------------------------------------------------
app.post("/api/import", async (c) => {
  const body = await c.req.json<{ rawJson?: string; dryRun?: boolean; force?: boolean }>();
  const rawJson = (body.rawJson ?? "").trim();
  if (!rawJson) throw new HTTPException(400, { message: "rawJson is required" });
  if (rawJson.length > 25_000_000) {
    throw new HTTPException(413, { message: "payload is larger than 25 MB; that is not a KI report" });
  }

  let payload;
  try {
    payload = load(rawJson);
  } catch {
    return c.json({ error: "not valid JSON", kind: "json" }, 422);
  }

  const cfg = await loadConfig(c.env.DB);
  const norm = normalize(payload, { areaBand: [cfg.areaBand.low, cfg.areaBand.high] });
  const weekly = isWeeklyPayload(payload);

  // resolve against the current crosswalk to surface unmapped areas
  const [crosswalk, canonical, areaWard] = await Promise.all([
    getCrosswalkRows(c.env.DB),
    getCanonicalRows(c.env.DB),
    getAreaWardRows(c.env.DB),
  ]);
  const rr = resolveWeek(norm.facts, norm.weekStart, { crosswalk, areaWard, canonical });

  const [existing, structure] = await Promise.all([
    loadFacts(c.env.DB, norm.weekStart),
    describeStructureChange(c.env.DB, norm),
  ]);
  const summary = {
    weekStart: norm.weekStart,
    weekEnd: norm.weekEnd,
    weekLabel: weekLabel(norm.weekStart),
    activeAreas: norm.activeAreaIds.size,
    nFacts: norm.facts.length,
    nWardFacts: norm.wardFacts.length,
    nMissionaries: norm.missionaries.length,
    warnings: norm.warnings,
    notes: norm.notes,
    inactiveWithData: norm.inactiveWithData,
    alreadyStored: existing.length > 0,
    /** false when the range is not one Mon–Sun week; storing then needs force=true */
    weekly,
    unmapped: rr.unmapped.map(([id, name]) => ({ imosAreaId: id, imosAreaName: name })),
    /** what moved vs the previous stored week (a transfer) and vs the stored copy of this week */
    structure,
  };

  if (body.dryRun) return c.json({ dryRun: true, summary });

  // A non-week range (a month, a Sunday-start week) would be stored as one
  // fake "week" and skew every trend. Refuse unless the person explicitly
  // forced it after seeing the warning.
  if (!weekly && !body.force) {
    return c.json(
      {
        error:
          `${norm.weekStart} → ${norm.weekEnd} is not a Monday-to-Sunday reporting week. ` +
          `Re-pull the correct range, or tick "store anyway" if this is deliberate.`,
        kind: "not-a-week",
        summary,
      },
      422,
    );
  }
  // Re-importing a stored week with a *different structure* (areas added or
  // gone, zones changed) rewrites that week's history, not just its numbers.
  // Legitimate after a correction in IMOS; a mistake if the wrong week was
  // pulled or IMOS returned the current structure for an old range. Ask.
  if (structure.storedDrift && !body.force) {
    const d = structure.vsStored!;
    return c.json(
      {
        error:
          `Week ${norm.weekStart} is already stored with a different structure ` +
          `(${d.areasNew.length} area(s) would be added, ${d.areasGone.length} removed, ` +
          `${d.movedZone.length} moved zone). Storing replaces that week's structure. ` +
          `Tick "store anyway" if this pull is the correct one.`,
        kind: "stored-drift",
        summary,
      },
      422,
    );
  }

  const stored = await storeImport(c.env.DB, norm, rawJson, c.get("user"));
  await audit(c.env.DB, c.get("user"), "import", {
    weekStart: norm.weekStart,
    reused: stored.reused,
    warnings: norm.warnings.length,
    staleRemoved: stored.staleRemoved,
    forced: !weekly,
  });
  await bumpData(c.env);
  return c.json({ dryRun: false, summary, stored });
});

// --- views --------------------------------------------------------
app.get("/api/week/:week", async (c) => {
  const week = c.req.param("week");
  try {
    return c.json(await cached(c.env, `week:v3:${week}`, "ki", () => buildWeekView(c.env.DB, week)));
  } catch (e) {
    throw new HTTPException(404, { message: String((e as Error).message) });
  }
});

app.get("/api/trends", async (c) => {
  const q = c.req.query();
  // key prefix bumped when the payload shape changes (was SeriesRow[]; now {rows,goals})
  const key = `trends:v2:${q.upTo ?? ""}:${q.n ?? ""}:${q.zone ?? ""}:${q.mlcOnly ?? ""}`;
  const out = await cached(c.env, key, "ki", () =>
    buildTrends(c.env.DB, {
      upTo: q.upTo || undefined,
      n: q.n ? parseInt(q.n, 10) : undefined,
      zone: q.zone || null,
      mlcOnly: q.mlcOnly === "1" || q.mlcOnly === "true",
    }),
  );
  return c.json(out);
});

app.get("/api/stakes/:week", async (c) => {
  const week = c.req.param("week");
  return c.json(await cached(c.env, `stakes:${week}`, "ki", () => buildStakeView(c.env.DB, week)));
});

app.get("/api/chase/:week", async (c) => {
  const week = c.req.param("week");
  return c.json(await cached(c.env, `chase:${week}`, "ki", () => buildChase(c.env.DB, week)));
});

/** Acknowledge a not-reported area for the week so it stops flagging as attention. */
app.post("/api/chase/:week/ack", async (c) => {
  const week = c.req.param("week");
  const b = await c.req.json<{ imosAreaId: number; reason?: string }>();
  if (typeof b.imosAreaId !== "number") {
    throw new HTTPException(400, { message: "imosAreaId is required" });
  }
  await setNotReportedAck(c.env.DB, week, b.imosAreaId, b.reason?.trim() || null, c.get("user"));
  await audit(c.env.DB, c.get("user"), "not_reported.ack", { week, ...b });
  await bumpData(c.env);
  return c.json({ ok: true });
});

app.delete("/api/chase/:week/ack/:imosAreaId", async (c) => {
  const week = c.req.param("week");
  const id = parseInt(c.req.param("imosAreaId"), 10);
  await clearNotReportedAck(c.env.DB, week, id);
  await audit(c.env.DB, c.get("user"), "not_reported.unack", { week, imosAreaId: id });
  await bumpData(c.env);
  return c.json({ ok: true });
});

// --- crosswalk admin -------------------------------------------
app.get("/api/crosswalk", async (c) =>
  c.json(
    await cached(c.env, "crosswalk", "ki", async () => {
      const [canonical, crosswalk, areaWard] = await Promise.all([
        getCanonicalRows(c.env.DB),
        getCrosswalkRows(c.env.DB),
        getAreaWardRows(c.env.DB),
      ]);
      return { canonical, crosswalk, areaWard };
    }),
  ),
);

app.post("/api/crosswalk/attach", async (c) => {
  const b = await c.req.json<{
    imosAreaId: number;
    canonicalAreaKey: string;
    validFrom: string;
    note?: string;
  }>();
  await attachArea(c.env.DB, b.imosAreaId, b.canonicalAreaKey, b.validFrom, b.note ?? null);
  await audit(c.env.DB, c.get("user"), "crosswalk.attach", b);
  await bumpData(c.env);
  return c.json({ ok: true });
});

app.post("/api/crosswalk/canonical", async (c) => {
  const b = await c.req.json<{ key: string; displayName: string; createdAt?: string }>();
  await createCanonicalArea(
    c.env.DB,
    b.key,
    b.displayName,
    b.createdAt ?? new Date().toISOString().slice(0, 10),
  );
  await audit(c.env.DB, c.get("user"), "crosswalk.canonical", b);
  await bumpData(c.env);
  return c.json({ ok: true });
});

app.post("/api/crosswalk/ward", async (c) => {
  const b = await c.req.json<{
    canonicalAreaKey: string;
    wardUnitId: number;
    wardName: string;
    stake: string;
    validFrom: string;
  }>();
  await addWard(c.env.DB, b.canonicalAreaKey, b.wardUnitId, b.wardName, b.stake, b.validFrom);
  await audit(c.env.DB, c.get("user"), "crosswalk.ward", b);
  await bumpData(c.env);
  return c.json({ ok: true });
});

/**
 * Seed the identity tables from a stored week's raw payload + the bundled Area
 * To Ward Key. Run once per structure (pre- and post-transfer). Idempotent.
 */
app.post("/api/seed", async (c) => {
  const b = await c.req.json<{ weekStart: string; validFrom?: string }>();
  const run = await c.env.DB.prepare(
    "SELECT raw_json FROM import_run WHERE week_start = ? ORDER BY id DESC LIMIT 1",
  )
    .bind(b.weekStart)
    .first<{ raw_json: string }>();
  if (!run) throw new HTTPException(404, { message: `no stored import for ${b.weekStart}` });

  const payload = load(run.raw_json);
  const validFrom = b.validFrom ?? b.weekStart;
  const result = seed(payload, areaKey, validFrom);
  await seedCrosswalk(c.env.DB, result);
  await bumpData(c.env);
  await audit(c.env.DB, c.get("user"), "seed", {
    validFrom,
    canonical: result.canonicalAreas.length,
    crosswalk: result.areaCrosswalk.length,
    ward: result.areaWard.length,
    unresolved: result.unresolved.length,
  });
  return c.json({
    ok: true,
    validFrom,
    counts: {
      canonicalAreas: result.canonicalAreas.length,
      areaCrosswalk: result.areaCrosswalk.length,
      areaWard: result.areaWard.length,
    },
    unresolved: result.unresolved,
  });
});

// --- weekly console (dashboard) ------------------------------------
app.get("/api/console", async (c) => {
  // date in the key: "expected latest week" and sync-age roll over daily
  const view = await cached(c.env, `console:v3:${todayIso()}`, "both", () =>
    buildConsole(c.env.DB, areaKey),
  );
  // deployment facts a successor can read off the page (never cached)
  const system = {
    portalEnv: c.env.PORTAL_ENV ?? "unknown",
    accessTokenCheck: accessMode(c.env),
    friendsSyncSecretSet: !!c.env.FRIENDS_SYNC_SECRET,
    slidesReadSecretSet: !!c.env.SLIDES_READ_SECRET,
    responseCache: !!c.env.CACHE,
    missionTimeZone: "America/New_York",
  };
  return c.json({ ...view, system });
});

/** Tick / untick a checklist step for the latest week. */
app.post("/api/console/check", async (c) => {
  const b = await c.req.json<{ stepId: string; checked: boolean }>();
  if (!b.stepId) throw new HTTPException(400, { message: "stepId is required" });
  const latest = (await weeksAvailable(c.env.DB)).at(-1);
  if (!latest) throw new HTTPException(400, { message: "no weeks imported" });
  await setConsoleCheck(c.env.DB, latest, b.stepId, !!b.checked, c.get("user"));
  await bumpData(c.env);
  return c.json({ ok: true });
});

// --- config ------------------------------------------------------
app.get("/api/config", async (c) =>
  c.json(
    await cached(c.env, "config:v2", "ki", async () => ({
      config: await loadConfig(c.env.DB),
      defaults: CONFIG_DEFAULTS,
      keys: CONFIG_KEYS,
    })),
  ),
);

app.put("/api/config", async (c) => {
  const b = await c.req.json<{ key: string; value: unknown }>();
  if (!(CONFIG_KEYS as readonly string[]).includes(b.key)) {
    throw new HTTPException(400, { message: `unknown config key: ${b.key}` });
  }
  const problem = validateConfigValue(b.key as (typeof CONFIG_KEYS)[number], b.value);
  if (problem) throw new HTTPException(400, { message: problem });
  await setConfig(c.env.DB, b.key, b.value);
  await audit(c.env.DB, c.get("user"), "config.set", { key: b.key });
  await bumpData(c.env);
  return c.json({ ok: true, config: await loadConfig(c.env.DB) });
});

// --- structure (Admin → Areas) --------------------------------
app.get("/api/structure", async (c) =>
  c.json(await cached(c.env, "structure:v2", "ki", () => getStructure(c.env.DB))),
);

// --- transfer rollover ---------------------------------------
app.get("/api/rollover/:week", async (c) => {
  const week = c.req.param("week");
  return c.json(
    await cached(c.env, `rollover:v2:${week}`, "ki", () => buildRollover(c.env.DB, week, areaKey)),
  );
});

app.post("/api/rollover/:week/apply", async (c) => {
  const week = c.req.param("week");
  const b = await c.req.json<{
    validFrom?: string;
    areas: {
      imosAreaId: number;
      canonicalAreaKey: string;
      isNew: boolean;
      displayName: string;
    }[];
    wards: { orgId: number; canonicalAreaKey: string; wardName: string; stake: string }[];
    retire?: { imosAreaId: number; canonicalAreaKey: string; validFrom: string }[];
    /** the actual transfer day, for the record; mappings are still dated by reporting week */
    transferDate?: string;
  }>();
  const res = await applyRollover(c.env.DB, c.get("user"), {
    validFrom: b.validFrom || week,
    areas: b.areas ?? [],
    wards: b.wards ?? [],
    retire: b.retire ?? [],
    transferDate: isIsoDate(b.transferDate) ? b.transferDate : null,
  });
  await bumpData(c.env);
  return c.json({ ok: true, applied: res, plan: await buildRollover(c.env.DB, week, areaKey) });
});

// --- crosswalk edits ---------------------------------------
app.post("/api/crosswalk/canonical/rename", async (c) => {
  const b = await c.req.json<{ key: string; displayName: string }>();
  await renameCanonical(c.env.DB, b.key, b.displayName);
  await audit(c.env.DB, c.get("user"), "crosswalk.canonical.rename", b);
  await bumpData(c.env);
  return c.json({ ok: true });
});

app.post("/api/crosswalk/canonical/retire", async (c) => {
  const b = await c.req.json<{ key: string; retired: boolean }>();
  await setCanonicalRetired(
    c.env.DB,
    b.key,
    b.retired ? new Date().toISOString().slice(0, 10) : null,
  );
  await audit(c.env.DB, c.get("user"), "crosswalk.canonical.retire", b);
  await bumpData(c.env);
  return c.json({ ok: true });
});

app.post("/api/crosswalk/mapping/close", async (c) => {
  const b = await c.req.json<{ imosAreaId: number; validFrom: string; validTo: string }>();
  await closeMapping(c.env.DB, b.imosAreaId, b.validFrom, b.validTo);
  await audit(c.env.DB, c.get("user"), "crosswalk.mapping.close", b);
  await bumpData(c.env);
  return c.json({ ok: true });
});

app.post("/api/crosswalk/ward/close", async (c) => {
  const b = await c.req.json<{
    canonicalAreaKey: string;
    wardUnitId: number;
    validFrom: string;
    validTo: string;
  }>();
  await closeWard(c.env.DB, b.canonicalAreaKey, b.wardUnitId, b.validFrom, b.validTo);
  await audit(c.env.DB, c.get("user"), "crosswalk.ward.close", b);
  await bumpData(c.env);
  return c.json({ ok: true });
});

// --- ward events (Admin → Areas & wards quick actions) -----------------
app.post("/api/ward/move", async (c) => {
  const b = await c.req.json<{ wardUnitIds: number[]; stake: string; validFrom: string }>();
  const stake = String(b.stake ?? "").trim();
  const ids = (Array.isArray(b.wardUnitIds) ? b.wardUnitIds : []).filter((n) => Number.isInteger(n));
  if (!stake || ids.length === 0 || !isIsoDate(b.validFrom)) {
    throw new HTTPException(400, { message: "wardUnitIds[], stake and validFrom (YYYY-MM-DD) are required" });
  }
  let changed = 0;
  const unknown: number[] = [];
  for (const id of ids) {
    const n = await moveWardToStake(c.env.DB, id, stake, b.validFrom);
    if (n === 0) unknown.push(id);
    changed += n;
  }
  await audit(c.env.DB, c.get("user"), "ward.move", { ids, stake, validFrom: b.validFrom, changed });
  await bumpData(c.env);
  return c.json({ ok: true, changed, unknown });
});

app.post("/api/ward/rename", async (c) => {
  const b = await c.req.json<{ wardUnitId: number; wardName: string }>();
  const name = String(b.wardName ?? "").trim();
  if (!Number.isInteger(b.wardUnitId) || !name) {
    throw new HTTPException(400, { message: "wardUnitId and wardName are required" });
  }
  const changed = await renameWard(c.env.DB, b.wardUnitId, name);
  await audit(c.env.DB, c.get("user"), "ward.rename", { ...b, changed });
  await bumpData(c.env);
  return c.json({ ok: true, changed });
});

app.post("/api/ward/retire", async (c) => {
  const b = await c.req.json<{ wardUnitId: number; validTo: string; mergedInto?: number | null }>();
  if (!Number.isInteger(b.wardUnitId) || !isIsoDate(b.validTo)) {
    throw new HTTPException(400, { message: "wardUnitId and validTo (YYYY-MM-DD) are required" });
  }
  const changed = await retireWard(c.env.DB, b.wardUnitId, b.validTo);
  // "merged into" is a fact for the record (audit log); the surviving unit
  // keeps reporting under its own org id, so nothing else changes
  await audit(c.env.DB, c.get("user"), "ward.retire", {
    wardUnitId: b.wardUnitId,
    validTo: b.validTo,
    mergedInto: Number.isInteger(b.mergedInto) ? b.mergedInto : null,
    changed,
  });
  await bumpData(c.env);
  return c.json({ ok: true, changed });
});

app.post("/api/stake/rename", async (c) => {
  const b = await c.req.json<{ from: string; to: string }>();
  if (!b.from || !b.to) throw new HTTPException(400, { message: "from and to are required" });
  const changed = await renameStake(c.env.DB, b.from, b.to);
  await audit(c.env.DB, c.get("user"), "stake.rename", { ...b, changed });
  await bumpData(c.env);
  return c.json({ ok: true, changed });
});

// --- friends / on-date (read-only; source of truth is the Baptisms sheet) ---
app.get("/api/friends", async (c) => {
  const q = c.req.query();
  const key = `friends:${q.zone ?? ""}:${q.stake ?? ""}:${q.status ?? ""}`;
  const rows = await cached(c.env, key, "friends", () =>
    listFriends(c.env.DB, {
      zone: q.zone || undefined,
      stake: q.stake || undefined,
      status: (q.status as "on-date" | "baptized" | "all") || undefined,
    }),
  );
  return c.json({ friends: rows });
});

app.get("/api/friends/monthly", async (c) => {
  const n = Math.min(24, Math.max(1, parseInt(c.req.query("n") || "6", 10) || 6));
  const keyDay = todayIso();
  return c.json(
    await cached(c.env, `friends-monthly:v2:${n}:${keyDay}`, "friends", async () => {
      const months = await monthlyBaptisms(c.env.DB, n);
      const goals = await goalsForMonths(c.env.DB, months.map((m) => m.month));
      return { months: months.map((m) => ({ ...m, goal: goals[m.month] ?? null })) };
    }),
  );
});

/** Baptisms per zone per month and each zone's share: the basis for suggested zone goals. */
app.get("/api/friends/by-zone", async (c) => {
  const n = Math.min(24, Math.max(1, parseInt(c.req.query("n") || "6", 10) || 6));
  return c.json(
    await cached(c.env, `friends-by-zone:${n}:${todayIso()}`, "friends", () => baptismsByZone(c.env.DB, n)),
  );
});

app.get("/api/friends/summary", async (c) => {
  // No ?week → measure "this week" / "this month" against today's calendar
  // week and month (the STL sheet works in real time, not IMOS weeks). The
  // date is in the cache key so "overdue" and the week window roll over daily.
  const week = c.req.query("week") || null;
  const keyDay = week ?? todayIso();
  return c.json(
    await cached(c.env, `friends-summary:v2:${keyDay}`, "friends", async () => ({
      ...(await friendsSummary(c.env.DB, week)),
      goals: await progressFor(c.env.DB, week ?? todayIso()),
    })),
  );
});

// --- history from Tableau (Admin → Data; docs/legacy-ki-export.md) --------
app.post("/api/import/legacy", async (c) => {
  const b = await c.req.json<{ weekEnd?: string; rows?: LegacyAreaRow[] }>();
  let res;
  try {
    res = await storeLegacyWeek(c.env.DB, c.get("user"), String(b.weekEnd ?? ""), b.rows ?? []);
  } catch (e) {
    throw new HTTPException(400, { message: (e as Error).message });
  }
  if (!res.reused && !res.skipped) {
    await audit(c.env.DB, c.get("user"), "import.legacy", res);
    await bumpData(c.env);
  }
  return c.json(res);
});

app.post("/api/friends/legacy", async (c) => {
  const b = await c.req.json<{ rows?: LegacyBaptismRow[] }>();
  let res;
  try {
    res = await loadLegacyBaptisms(c.env.DB, c.get("user"), b.rows ?? []);
  } catch (e) {
    throw new HTTPException(400, { message: (e as Error).message });
  }
  await audit(c.env.DB, c.get("user"), "friends.legacy", res);
  if (res.inserted > 0 || res.confirmedLegacy > 0) await bumpFriends(c.env);
  return c.json(res);
});

// --- baptism goals (optional; Admin → Baptism goals) ---------------------
app.get("/api/goals", async (c) => {
  const year = c.req.query("year") || todayIso().slice(0, 4);
  if (!/^\d{4}$/.test(year)) throw new HTTPException(400, { message: "year must be YYYY" });
  return c.json(await cached(c.env, `goals:${year}`, "friends", () => goalsView(c.env.DB, year)));
});

app.put("/api/goals", async (c) => {
  const b = await c.req.json<{ entries?: GoalEntry[] }>();
  let res: { written: number; removed: number };
  try {
    res = await setGoalRows(c.env.DB, c.get("user"), b.entries ?? []);
  } catch (e) {
    throw new HTTPException(400, { message: (e as Error).message });
  }
  await audit(c.env.DB, c.get("user"), "goals.set", { entries: (b.entries ?? []).length, ...res });
  await bumpFriends(c.env);
  return c.json({ ok: true, ...res });
});

app.get("/api/friends/by-stake/:week", async (c) => {
  const week = c.req.param("week");
  return c.json(
    await cached(c.env, `friends-by-stake:${week}`, "friends", () =>
      friendsByStake(c.env.DB, week),
    ),
  );
});

/**
 * Add a completed baptism the sheet doesn't have (reconciliation "close the gap").
 * Portal-sourced, authoritative, invisible to the sheet sync.
 */
app.post("/api/friends/record", async (c) => {
  const b = await c.req.json<{
    name: string;
    baptismDate: string;
    ward?: string;
    stake?: string;
    zone?: string;
    missionaries?: string;
    notes?: string;
  }>();
  const res = await recordBaptism(c.env.DB, c.get("user"), b);
  await audit(c.env.DB, c.get("user"), "friends.record", {
    name: b.name,
    baptismDate: b.baptismDate,
    ...res,
  });
  if (!res.duplicate) await bumpFriends(c.env);
  return c.json({ ok: true, ...res });
});

/** Remove a portal-recorded baptism (mistaken entry). Sheet rows are untouchable here. */
app.delete("/api/friends/record/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT source, name FROM friend WHERE id = ?")
    .bind(id)
    .first<{ source: string; name: string }>();
  if (!row) throw new HTTPException(404, { message: "no such record" });
  if (row.source !== "portal") {
    throw new HTTPException(409, { message: "only portal-recorded baptisms can be removed here" });
  }
  // friend_week rows reference the friend (FK) — the helper removes both
  await deletePortalFriend(c.env.DB, id);
  await audit(c.env.DB, c.get("user"), "friends.record.delete", { id, name: row.name });
  await bumpFriends(c.env);
  return c.json({ ok: true });
});

/**
 * Deliberately correct a completed baptism that shouldn't count (it never
 * happened, was a duplicate, or wasn't a convert baptism). Works on any
 * source — unlike the DELETE above, which only touches portal-added rows.
 * Un-confirms and deactivates the record; the reason is kept in its notes.
 */
app.post("/api/friends/:id/correct", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json<{ reason?: string }>();
  let res: { name: string };
  try {
    res = await correctBaptism(c.env.DB, c.get("user"), id, b.reason ?? "");
  } catch (e) {
    throw new HTTPException(400, { message: (e as Error).message });
  }
  await audit(c.env.DB, c.get("user"), "friends.correct", { id, name: res.name, reason: b.reason });
  await bumpFriends(c.env);
  return c.json({ ok: true, ...res });
});

// --- data page (read-only browse) --------------------------------
app.get("/api/data", async (c) =>
  c.json(
    await cached(c.env, "data", "both", async () => ({
      imports: await getImportLog(c.env.DB),
      audit: await getAuditLog(c.env.DB, 120),
      syncs: await getFriendSyncLog(c.env.DB, 30),
    })),
  ),
);

app.get("/api/data/raw/:week", async (c) => {
  const raw = await getRawPayload(c.env.DB, c.req.param("week"));
  if (!raw) throw new HTTPException(404, { message: "no stored payload for that week" });
  return new Response(raw, {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="imos-${c.req.param("week")}.json"`,
    },
  });
});

/**
 * Full database dump as JSON — a portable, self-serve backup (admin only).
 * Streamed table by table, and the big tables page through in row chunks, so
 * the Worker never holds the whole database in memory: import_run.raw_json
 * alone grows ~15–20 MB a year.
 */
const EXPORT_TABLES = [
  "import_run", "ki_fact", "ward_fact", "missionary_snapshot", "area_history",
  "canonical_area", "area_crosswalk", "area_ward", "friend", "friend_week",
  "friend_sync", "not_reported_ack", "console_check", "stake_recipients", "config", "audit_log",
  "baptism_goal",
] as const;
app.get("/api/export", async (c) => {
  const db = c.env.DB;
  const enc = new TextEncoder();
  const PAGE = 500;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const w = (s: string) => controller.enqueue(enc.encode(s));
      try {
        w(`{"exportedAt":${JSON.stringify(new Date().toISOString())},"tables":{`);
        let firstTable = true;
        for (const t of EXPORT_TABLES) {
          w(`${firstTable ? "" : ","}${JSON.stringify(t)}:[`);
          firstTable = false;
          let offset = 0;
          let firstRow = true;
          for (;;) {
            const { results } = await db
              .prepare(`SELECT * FROM ${t} LIMIT ? OFFSET ?`)
              .bind(PAGE, offset)
              .all();
            const rows = results ?? [];
            for (const r of rows) {
              w(`${firstRow ? "" : ","}${JSON.stringify(r)}`);
              firstRow = false;
            }
            if (rows.length < PAGE) break;
            offset += PAGE;
          }
          w("]");
        }
        w("}}");
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="wdcsm-reporting-${todayIso()}.json"`,
    },
  });
});

// --- publish (boards + stake reports) ---------------------------
app.get("/api/publish/:week", async (c) => {
  const week = c.req.param("week");
  return c.json(await cached(c.env, `publish:v3:${week}`, "both", () => buildPublish(c.env.DB, week)));
});

app.get("/api/recipients", async (c) =>
  c.json({
    recipients: await getStakeRecipients(c.env.DB),
    ccAll: await getConfig<string[]>(c.env.DB, "report_cc_all", []),
    emailTemplate: await getConfig<EmailTemplate>(
      c.env.DB,
      "report_email_template",
      DEFAULT_EMAIL_TEMPLATE,
    ),
    defaultEmailTemplate: DEFAULT_EMAIL_TEMPLATE,
  }),
);

/** The editable cover-letter template ({stake} {president} {date} {weekLabel}). */
app.post("/api/recipients/template", async (c) => {
  const b = await c.req.json<{ subject?: string; body?: string }>();
  const t: EmailTemplate = {
    subject: String(b.subject ?? "").trim() || DEFAULT_EMAIL_TEMPLATE.subject,
    body: String(b.body ?? "").trim() || DEFAULT_EMAIL_TEMPLATE.body,
  };
  await setConfig(c.env.DB, "report_email_template", t);
  await audit(c.env.DB, c.get("user"), "recipients.template", {});
  await bumpData(c.env);
  return c.json({ ok: true, emailTemplate: t });
});

app.post("/api/recipients", async (c) => {
  const b = await c.req.json<{
    stake: string;
    presidentName?: string;
    toEmails?: string;
  }>();
  if (!b.stake) throw new HTTPException(400, { message: "stake is required" });
  await upsertStakeRecipient(
    c.env.DB,
    {
      stake: b.stake,
      presidentName: b.presidentName ?? null,
      toEmails: b.toEmails ?? null,
      ccEmails: null,
    },
    c.get("user"),
  );
  await audit(c.env.DB, c.get("user"), "recipients.set", { stake: b.stake });
  await bumpData(c.env);
  return c.json({ ok: true });
});

/** The single CC list applied to every stake report. */
app.post("/api/recipients/cc", async (c) => {
  const b = await c.req.json<{ ccAll: string[] }>();
  const list = (Array.isArray(b.ccAll) ? b.ccAll : [])
    .map((s) => String(s).trim())
    .filter((s) => s.includes("@"));
  await setConfig(c.env.DB, "report_cc_all", list);
  await audit(c.env.DB, c.get("user"), "recipients.cc", { count: list.length });
  await bumpData(c.env);
  return c.json({ ok: true, ccAll: list });
});

app.post("/api/recipients/seed", async (c) => {
  const seed = stakeRecipientsSeed as {
    stake: string;
    to: string;
    cc: string;
    president: string;
  }[];
  for (const r of seed) {
    await upsertStakeRecipient(
      c.env.DB,
      { stake: r.stake, presidentName: r.president || null, toEmails: r.to || null, ccEmails: null },
      "recipients-seed",
    );
  }
  // the sheet's CC column is identical across every stake — lift it to the one
  // mission-wide CC list
  const cc = [
    ...new Set(
      seed
        .flatMap((r) => (r.cc || "").split(/[,;\s]+/))
        .map((s) => s.trim())
        .filter((s) => s.includes("@")),
    ),
  ];
  if (cc.length) await setConfig(c.env.DB, "report_cc_all", cc);

  await bumpData(c.env);
  return c.json({ ok: true, seeded: seed.length, ccAll: cc });
});

app.get("/api/reconcile", async (c) => {
  const month =
    c.req.query("month") ||
    (await weeksAvailable(c.env.DB)).at(-1)?.slice(0, 7) ||
    todayIso().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) throw new HTTPException(400, { message: "month must be YYYY-MM" });
  return c.json(
    await cached(c.env, `reconcile:${month}`, "both", () => buildReconcile(c.env.DB, month)),
  );
});

/**
 * Snapshot push from the Apps Script bound to the Baptisms (MLC) sheet.
 * Auth: `Authorization: Bearer <FRIENDS_SYNC_SECRET>` (this path is excluded
 * from the Access user check; add a matching Access "Bypass" rule for it).
 */
app.post("/api/friends/sync", async (c) => {
  const secret = c.env.FRIENDS_SYNC_SECRET;
  const given = (c.req.header("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!secret || given !== secret) throw new HTTPException(401, { message: "bad sync secret" });

  const body = await c.req.json<{ weekStart?: string; rows?: SheetRow[] }>();
  if (!Array.isArray(body.rows)) throw new HTTPException(400, { message: "rows[] required" });

  // The snapshot is the sheet *now*, so it is filed under the current week
  // (the server's own clock, mission tz) — not whatever week the caller says.
  const res = await syncFriends(c.env.DB, body.rows, null);
  await audit(c.env.DB, "sheet-sync", "friends.sync", res);
  // only invalidate the friends cache when the snapshot actually changed something
  // (a grace-period stamp shows on the Baptisms page, so it counts)
  if (res.changed > 0 || res.deactivated > 0 || res.missing > 0) await bumpFriends(c.env);
  return c.json({ ok: true, ...res });
});

/**
 * Numbers for the Monday MLC Slides decks, read by apps_script/slides-refresh.gs.
 * Auth: `Authorization: Bearer <SLIDES_READ_SECRET>` (excluded from the Access
 * user check like the sheet webhook; needs a matching Access "Bypass" path rule).
 * Carries no names: zone and mission indicator totals plus the MLC share.
 */
app.get("/api/slides/:mode", async (c) => {
  const secret = c.env.SLIDES_READ_SECRET;
  const given = (c.req.header("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!secret || given !== secret) throw new HTTPException(401, { message: "bad slides secret" });
  const mode = c.req.param("mode");
  if (mode !== "weekly" && mode !== "monthly") {
    throw new HTTPException(404, { message: "mode must be weekly or monthly" });
  }
  const week = c.req.query("week") || undefined;
  if (week && !isIsoDate(week)) throw new HTTPException(400, { message: "week must be YYYY-MM-DD" });
  const today = todayIso();
  return c.json(
    await cached(c.env, `slides:v1:${mode}:${week ?? "latest"}:${today}`, "both", () =>
      buildSlides(c.env.DB, mode, week, today),
    ),
  );
});

app.all("/api/*", (c) => c.json({ error: "no such endpoint" }, 404));

// --- SPA fallback ------------------------------------------------
app.get("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
