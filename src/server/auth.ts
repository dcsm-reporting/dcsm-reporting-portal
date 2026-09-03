/**
 * Cloudflare Access token verification (opt-in).
 *
 * By default the Worker trusts the `Cf-Access-Authenticated-User-Email` header
 * that Access injects. That is safe as long as *every* route to this Worker
 * passes through Access. The moment a second hostname is attached without an
 * Access application in front of it, or the Access app is deleted, anyone can
 * send that header and be whoever they claim.
 *
 * Setting two vars closes that hole: the Worker then also requires the
 * `Cf-Access-Jwt-Assertion` header, checks its RS256 signature against the
 * team's published keys, and checks the audience tag and expiry. Nothing else
 * in the app changes.
 *
 *   wrangler.toml [vars]
 *     ACCESS_TEAM_DOMAIN = "late-fire-fa86.cloudflareaccess.com"
 *     ACCESS_AUD         = "<Application Audience (AUD) tag from the Access app>"
 *
 * Leave both unset to keep header-only trust (local dev, or before the app is
 * set up). Setting exactly one is a configuration error and fails closed.
 */

export interface AccessEnv {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  CACHE?: KVNamespace;
}

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
}

const KEY_TTL_MS = 60 * 60 * 1000;
let keyCache: { at: number; keys: Jwk[]; domain: string } | null = null;

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlToJson<T>(s: string): T {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s))) as T;
}

async function fetchKeys(domain: string, env: AccessEnv): Promise<Jwk[]> {
  if (keyCache && keyCache.domain === domain && Date.now() - keyCache.at < KEY_TTL_MS) {
    return keyCache.keys;
  }
  const kvKey = `access-certs:${domain}`;
  if (env.CACHE) {
    const hit = await env.CACHE.get<{ keys: Jwk[] }>(kvKey, "json").catch(() => null);
    if (hit?.keys?.length) {
      keyCache = { at: Date.now(), keys: hit.keys, domain };
      return hit.keys;
    }
  }
  const res = await fetch(`https://${domain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`could not fetch Access certs (${res.status})`);
  const body = (await res.json()) as { keys?: Jwk[] };
  const keys = (body.keys ?? []).filter((k) => k.kty === "RSA" && k.n && k.e && k.kid);
  if (keys.length === 0) throw new Error("Access certs response carried no RSA keys");
  keyCache = { at: Date.now(), keys, domain };
  if (env.CACHE) {
    await env.CACHE.put(kvKey, JSON.stringify({ keys }), { expirationTtl: 3600 }).catch(() => {});
  }
  return keys;
}

export interface AccessClaims {
  email: string;
  sub?: string;
  exp: number;
}

/**
 * Verify an Access JWT and return its claims, or throw with a human reason.
 * Rejects an unknown `kid` once with a forced key refresh (rotation).
 */
export async function verifyAccessJwt(
  token: string,
  env: AccessEnv,
): Promise<AccessClaims> {
  const domain = env.ACCESS_TEAM_DOMAIN!;
  const aud = env.ACCESS_AUD!;
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed Access token");
  const [h, p, s] = parts as [string, string, string];
  const header = b64urlToJson<{ alg?: string; kid?: string }>(h);
  if (header.alg !== "RS256" || !header.kid) throw new Error("unexpected Access token algorithm");

  let keys = await fetchKeys(domain, env);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    keyCache = null;
    keys = await fetchKeys(domain, env);
    jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) throw new Error("Access token signed by an unknown key");
  }

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlToBytes(s),
    new TextEncoder().encode(`${h}.${p}`),
  );
  if (!ok) throw new Error("Access token signature does not verify");

  const claims = b64urlToJson<{
    aud?: string | string[];
    exp?: number;
    nbf?: number;
    iss?: string;
    email?: string;
    sub?: string;
  }>(p);
  const now = Math.floor(Date.now() / 1000);
  const audList = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
  if (!audList.includes(aud)) throw new Error("Access token audience does not match this app");
  if (typeof claims.exp !== "number" || claims.exp < now - 30) throw new Error("Access token expired");
  if (typeof claims.nbf === "number" && claims.nbf > now + 30) throw new Error("Access token not yet valid");
  if (claims.iss && claims.iss !== `https://${domain}`) throw new Error("Access token issuer mismatch");
  if (!claims.email) throw new Error("Access token carries no email");
  return { email: claims.email, sub: claims.sub, exp: claims.exp };
}

/** "off" = header trust only; "on" = verify; "misconfigured" = exactly one var set. */
export function accessMode(env: AccessEnv): "off" | "on" | "misconfigured" {
  const a = !!env.ACCESS_TEAM_DOMAIN;
  const b = !!env.ACCESS_AUD;
  if (a && b) return "on";
  if (!a && !b) return "off";
  return "misconfigured";
}
