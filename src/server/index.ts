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
import { resolveWeek } from "../pipeline/resolve.js";
import type { Env, Vars } from "./env.js";
import { CONFIG_DEFAULTS, CONFIG_KEYS, loadConfig } from "./config.js";
import { bumpData, bumpFriends, cached } from "./cache.js";
import {
  addWard,
  attachArea,
  audit,
  clearNotReportedAck,
  closeMapping,
  closeWard,
  createCanonicalArea,
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
  renameCanonical,
  renameStake,
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
  weekLabel,
} from "./service.js";
import {
  friendsByStake,
  friendsSummary,
  listFriends,
  monthlyBaptisms,
  recordBaptism,
  syncFriends,
  type SheetRow,
} from "./friends.js";
import { buildReconcile } from "./reconcile.js";
import { buildPublish } from "./publish.js";
import { getStakeRecipients, upsertStakeRecipient } from "./db.js";
import stakeRecipientsSeed from "../../resources/stake_recipients.json";

/** Parsed once — the Area To Ward Key is bundled as text. */
const areaKey = loadAreaKey(areaKeyCsv);

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// --- auth ---------------------------------------------------------------
app.use("/api/*", async (c, next) => {
  // health check and the sheet-sync webhook do their own thing
  if (c.req.path === "/api/health" || c.req.path === "/api/friends/sync") return next();
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

app.get("/api/weeks", async (c) =>
  c.json(
    await cached(c.env, "weeks", "ki", async () => {
      const weeks = await weeksAvailable(c.env.DB);
      return {
        weeks: weeks.map((w) => ({ weekStart: w, weekLabel: weekLabel(w) })),
        latest: weeks[weeks.length - 1] ?? null,
      };
    }),
  ),
);

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
  await bumpData(c.env);
  return c.json({ dryRun: false, summary, stored });
});

// --- views --------------------------------------------------------
app.get("/api/week/:week", async (c) => {
  const week = c.req.param("week");
  try {
    return c.json(await cached(c.env, `week:${week}`, "ki", () => buildWeekView(c.env.DB, week)));
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
app.get("/api/console", async (c) =>
  c.json(await cached(c.env, "console", "both", () => buildConsole(c.env.DB, areaKey))),
);

// --- config ------------------------------------------------------
app.get("/api/config", async (c) =>
  c.json(
    await cached(c.env, "config", "ki", async () => ({
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
  await setConfig(c.env.DB, b.key, b.value);
  await audit(c.env.DB, c.get("user"), "config.set", { key: b.key });
  await bumpData(c.env);
  return c.json({ ok: true, config: await loadConfig(c.env.DB) });
});

// --- structure (Admin → Areas) --------------------------------
app.get("/api/structure", async (c) =>
  c.json(await cached(c.env, "structure", "ki", () => getStructure(c.env.DB))),
);

// --- transfer rollover ---------------------------------------
app.get("/api/rollover/:week", async (c) => {
  const week = c.req.param("week");
  return c.json(
    await cached(c.env, `rollover:${week}`, "ki", () => buildRollover(c.env.DB, week, areaKey)),
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
  }>();
  const res = await applyRollover(c.env.DB, c.get("user"), {
    validFrom: b.validFrom || week,
    areas: b.areas ?? [],
    wards: b.wards ?? [],
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
  const keyDay = new Date().toISOString().slice(0, 10);
  return c.json(
    await cached(c.env, `friends-monthly:${n}:${keyDay}`, "friends", async () => ({
      months: await monthlyBaptisms(c.env.DB, n),
    })),
  );
});

app.get("/api/friends/summary", async (c) => {
  // No ?week → measure "this week" / "this month" against today's calendar
  // week and month (the STL sheet works in real time, not IMOS weeks). The
  // date is in the cache key so "overdue" and the week window roll over daily.
  const week = c.req.query("week") || null;
  const keyDay = week ?? new Date().toISOString().slice(0, 10);
  return c.json(
    await cached(c.env, `friends-summary:${keyDay}`, "friends", () =>
      friendsSummary(c.env.DB, week),
    ),
  );
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
  await c.env.DB.prepare("DELETE FROM friend WHERE id = ? AND source = 'portal'").bind(id).run();
  await audit(c.env.DB, c.get("user"), "friends.record.delete", { id, name: row.name });
  await bumpFriends(c.env);
  return c.json({ ok: true });
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

/** Full database dump as JSON — a portable, self-serve backup. */
app.get("/api/export", async (c) => {
  const tables = [
    "import_run", "ki_fact", "ward_fact", "missionary_snapshot", "area_history",
    "canonical_area", "area_crosswalk", "area_ward", "friend", "friend_week",
    "friend_sync", "stake_recipients", "config", "audit_log",
  ];
  const dump: Record<string, unknown[]> = {};
  for (const t of tables) {
    const { results } = await c.env.DB.prepare(`SELECT * FROM ${t}`).all();
    dump[t] = results ?? [];
  }
  const body = JSON.stringify(
    { exportedAt: new Date().toISOString(), tables: dump },
    null,
    0,
  );
  return new Response(body, {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="dcsm-ki-portal-${new Date()
        .toISOString()
        .slice(0, 10)}.json"`,
    },
  });
});

// --- publish (boards + stake reports) ---------------------------
app.get("/api/publish/:week", async (c) => {
  const week = c.req.param("week");
  return c.json(await cached(c.env, `publish:${week}`, "both", () => buildPublish(c.env.DB, week)));
});

app.get("/api/recipients", async (c) => c.json({ recipients: await getStakeRecipients(c.env.DB) }));

app.post("/api/recipients", async (c) => {
  const b = await c.req.json<{
    stake: string;
    presidentName?: string;
    toEmails?: string;
    ccEmails?: string;
  }>();
  if (!b.stake) throw new HTTPException(400, { message: "stake is required" });
  await upsertStakeRecipient(
    c.env.DB,
    {
      stake: b.stake,
      presidentName: b.presidentName ?? null,
      toEmails: b.toEmails ?? null,
      ccEmails: b.ccEmails ?? null,
    },
    c.get("user"),
  );
  await audit(c.env.DB, c.get("user"), "recipients.set", { stake: b.stake });
  await bumpData(c.env);
  return c.json({ ok: true });
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
      { stake: r.stake, presidentName: r.president || null, toEmails: r.to || null, ccEmails: r.cc || null },
      "recipients-seed",
    );
  }
  await bumpData(c.env);
  return c.json({ ok: true, seeded: seed.length });
});

app.get("/api/reconcile", async (c) => {
  const month =
    c.req.query("month") ||
    (await weeksAvailable(c.env.DB)).at(-1)?.slice(0, 7) ||
    new Date().toISOString().slice(0, 7);
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

  const week = body.weekStart || (await weeksAvailable(c.env.DB)).at(-1) || null;
  const res = await syncFriends(c.env.DB, body.rows, week);
  await audit(c.env.DB, "sheet-sync", "friends.sync", res);
  // only invalidate the friends cache when the snapshot actually changed something
  if (res.changed > 0 || res.deactivated > 0) await bumpFriends(c.env);
  return c.json({ ok: true, ...res });
});

app.all("/api/*", (c) => c.json({ error: "no such endpoint" }, 404));

// --- SPA fallback ------------------------------------------------
app.get("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
