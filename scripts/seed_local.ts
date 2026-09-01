/**
 * Load the 12 bundled sample weeks into the running local Worker, then seed the
 * crosswalk from the newest week. Requires `wrangler dev` (default :8787).
 *
 *   npm run dev:api          # in one terminal
 *   npm run seed:local       # in another
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE ?? "http://localhost:8787";
const SAMPLES = fileURLToPath(new URL("../samples/", import.meta.url));

async function post(path: string, body: unknown) {
  const r = await fetch(BASE + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path} → ${r.status} ${JSON.stringify(data)}`);
  return data as Record<string, unknown>;
}

const files = readdirSync(SAMPLES)
  .filter((f) => /^20\d\d-\d\d-\d\d\.json$/.test(f))
  .sort();

let newest = "";
for (const f of files) {
  const rawJson = readFileSync(SAMPLES + f, "utf-8");
  const res = (await post("/api/import", { rawJson, dryRun: false })) as {
    summary: { weekStart: string; activeAreas: number; warnings: string[] };
  };
  newest = res.summary.weekStart;
  console.log(
    `imported ${f}  → ${res.summary.weekStart}  areas=${res.summary.activeAreas}  warnings=${res.summary.warnings.length}`,
  );
}

const seed = await post("/api/seed", { weekStart: newest });
console.log("seeded crosswalk:", JSON.stringify(seed.counts), "unresolved:", seed.unresolved);
console.log("done.");
