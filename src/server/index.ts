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
import { load, normalize, ValidationError } from "../pipeline/readImos.js";
import { loadAreaKey, seed } from "../pipeline/crosswalkSeed.js";
import type { Env, Vars } from "./env.js";
import {
  addWard,
  attachArea,
  audit,
  createCanonicalArea,
  getAreaWardRows,
  getCanonicalRows,
  getCrosswalkRows,
  loadFacts,
  seedCrosswalk,
  storeImport,
  weeksAvailable,
} from "./db.js";
import {
  buildChase,
  buildStakeView,
  buildTrends,
  buildWeekView,
  weekLabel,
} from "./service.js";

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// --- auth ---------------------------------------------------------------
app.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/health") return next();
  const email =
    c.req.header("Cf-Access-Authenticated-User-Email") ||
    c.req.header("cf-access-authenticated-user-email") ||
    c.env.DEV_USER;
  if (!email) throw new HTTPException(401, { message: "not authenticated" });
  if (c.env.ALLOWED_EMAILS) {
    const ok = c.env.ALLOWED_EMAILS.split(",").map((s) => s.trim().toLowerCase());
    if (!ok.includes(email.toLowerCase())) throw new HTTPException(403, { message: "not allowed" });
  }
  c.set("user", email);
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
app.get("/api/me", (c) => c.json({ user: c.get("user") }));

app.get("/api/weeks", async (c) => {
  const weeks = await weeksAvailable(c.env.DB);
  return c.json({
    weeks: weeks.map((w) => ({ weekStart: w, weekLabel: weekLabel(w) })),
    latest: weeks[weeks.length - 1] ?? null,
  });
});

// --- import ---------------------------------------------------------
app.post("/api/import", async (c) => {
  const body = await c.req.json<{ rawJson?: string; dryRun?: boolean }>();
  const rawJson = (body.rawJson ?? "").trim();
  if (!rawJson) throw new HTTPException(400, { message: "rawJson is required" });

  let payload;
  try {
    payload = load(rawJson);
  } catch {
    return c.json({ error: "not valid JSON", kind: "json" }, 422);
  }

  const norm = normalize(payload, { areaBand: [80, 130] });

  // resolve against the current crosswalk to surface unmapped areas
  const [crosswalk, canonical, areaWard] = await Promise.all([
    getCrosswalkRows(c.env.DB),
    getCanonicalRows(c.env.DB),
    getAreaWardRows(c.env.DB),
  ]);
  const { resolveWeek } = await import("../pipeline/resolve.js");
  const rr = resolveWeek(norm.facts, norm.weekStart, { crosswalk, areaWard, canonical });

  const existing = await loadFacts(c.env.DB, norm.weekStart);
  const summary = {
    weekStart: norm.weekStart,
    weekEnd: norm.weekEnd,
    weekLabel: weekLabel(norm.weekStart),
    activeAreas: norm.activeAreaIds.size,
    nFacts: norm.facts.length,
    nWardFacts: norm.wardFacts.length,
    nMissionaries: norm.missionaries.length,
    warnings: norm.warnings,
    alreadyStored: existing.length > 0,
    unmapped: rr.unmapped.map(([id, name]) => ({ imosAreaId: id, imosAreaName: name })),
  };

  if (body.dryRun) return c.json({ dryRun: true, summary });

  const stored = await storeImport(c.env.DB, norm, rawJson, c.get("user"));
  await audit(c.env.DB, c.get("user"), "import", {
    weekStart: norm.weekStart,
    reused: stored.reused,
    warnings: norm.warnings.length,
  });
  return c.json({ dryRun: false, summary, stored });
});

// --- views --------------------------------------------------------
app.get("/api/week/:week", async (c) => {
  try {
    return c.json(await buildWeekView(c.env.DB, c.req.param("week")));
  } catch (e) {
    throw new HTTPException(404, { message: String((e as Error).message) });
  }
});

app.get("/api/trends", async (c) => {
  const q = c.req.query();
  const rows = await buildTrends(c.env.DB, {
    upTo: q.upTo || undefined,
    n: q.n ? parseInt(q.n, 10) : undefined,
    zone: q.zone || null,
    mlcOnly: q.mlcOnly === "1" || q.mlcOnly === "true",
  });
  return c.json({ rows });
});

app.get("/api/stakes/:week", async (c) =>
  c.json(await buildStakeView(c.env.DB, c.req.param("week"))),
);

app.get("/api/chase/:week", async (c) =>
  c.json(await buildChase(c.env.DB, c.req.param("week"))),
);

// --- crosswalk admin -------------------------------------------
app.get("/api/crosswalk", async (c) => {
  const [canonical, crosswalk, areaWard] = await Promise.all([
    getCanonicalRows(c.env.DB),
    getCrosswalkRows(c.env.DB),
    getAreaWardRows(c.env.DB),
  ]);
  return c.json({ canonical, crosswalk, areaWard });
});

app.post("/api/crosswalk/attach", async (c) => {
  const b = await c.req.json<{
    imosAreaId: number;
    canonicalAreaKey: string;
    validFrom: string;
    note?: string;
  }>();
  await attachArea(c.env.DB, b.imosAreaId, b.canonicalAreaKey, b.validFrom, b.note ?? null);
  await audit(c.env.DB, c.get("user"), "crosswalk.attach", b);
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
  const result = seed(payload, loadAreaKey(areaKeyCsv), validFrom);
  await seedCrosswalk(c.env.DB, result);
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

app.all("/api/*", (c) => c.json({ error: "no such endpoint" }, 404));

// --- SPA fallback ------------------------------------------------
app.get("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
