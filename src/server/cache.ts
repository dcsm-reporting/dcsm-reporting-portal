/**
 * KV response cache. The assembled views (week / stakes / trends / console /
 * structure / friends) are expensive in D1 row-reads and only change on a
 * write, so cache them and invalidate by bumping a version counter.
 *
 * Two counters:
 *   dv  — KI facts, crosswalk, config       (bumped on import/seed/rollover/…)
 *   fv  — friends                            (bumped on a friends sync that changed something)
 *
 * Degrades to a straight passthrough when no KV binding is present (local dev).
 */

export interface CacheEnv {
  CACHE?: KVNamespace;
}

type Scope = "ki" | "friends" | "both";

async function versionOf(env: CacheEnv, name: "dv" | "fv"): Promise<string> {
  if (!env.CACHE) return "0";
  return (await env.CACHE.get(name)) ?? "0";
}

async function scopeVersion(env: CacheEnv, scope: Scope): Promise<string> {
  if (scope === "ki") return versionOf(env, "dv");
  if (scope === "friends") return versionOf(env, "fv");
  const [a, b] = await Promise.all([versionOf(env, "dv"), versionOf(env, "fv")]);
  return `${a}.${b}`;
}

export async function bump(env: CacheEnv, name: "dv" | "fv"): Promise<void> {
  if (!env.CACHE) return;
  const cur = parseInt((await env.CACHE.get(name)) ?? "0", 10) || 0;
  await env.CACHE.put(name, String(cur + 1));
}

/** Bump the KI/structure/config version — call after any such write. */
export const bumpData = (env: CacheEnv) => bump(env, "dv");
/** Bump the friends version — call after a friends sync that changed rows. */
export const bumpFriends = (env: CacheEnv) => bump(env, "fv");

export async function cached<T>(
  env: CacheEnv,
  logicalKey: string,
  scope: Scope,
  fn: () => Promise<T>,
  ttlSeconds = 3600,
): Promise<T> {
  if (!env.CACHE) return fn();
  const v = await scopeVersion(env, scope);
  const key = `c:${v}:${logicalKey}`;
  const hit = await env.CACHE.get(key, "json");
  if (hit !== null) return hit as T;
  const fresh = await fn();
  // best-effort; a failed put just means a recompute next time
  try {
    await env.CACHE.put(key, JSON.stringify(fresh), { expirationTtl: Math.max(60, ttlSeconds) });
  } catch {
    /* ignore */
  }
  return fresh;
}
