# DCSM KI Portal

Washington DC South Mission — weekly Key Indicators reporting. One web app,
role-account owned, $0 to run. React SPA + Cloudflare Worker + D1 (SQLite).

- **Architecture & rationale:** [ARCHITECTURE.md](ARCHITECTURE.md)
- **What's built / what's next / your setup steps:** [STATUS.md](STATUS.md)
- **Spec + test oracle:** the Python at `../ki-pipeline/` (do not run it in prod)

## Quickstart (local)

```bash
npm install
npm run db:migrate:local     # create the local D1 database
npm run build                # build the SPA (wrangler dev serves it)
npm run dev:api              # http://localhost:8787
npm run seed:local           # load 12 sample weeks + seed the crosswalk
```

Open <http://localhost:8787>. For UI work with hot reload run `npm run dev`
(Vite :5173, proxies `/api` to :8787) alongside `npm run dev:api`.

## Tests

```bash
npm run oracle       # regenerate test/oracle/*.json from the Python (needs python + ../ki-pipeline)
npm test             # 78 tests: unit ports + TS-vs-Python diff over all 12 weeks
npm run typecheck
```

## Deploy (first time)

```bash
npx wrangler login
npx wrangler d1 create dcsm_ki          # put the database_id in wrangler.toml
npx wrangler d1 migrations apply dcsm_ki --remote
npm run deploy
```

Then put **Cloudflare Access** in front of the deployed URL (Zero Trust
dashboard, free plan) with the leader email allowlist. See STATUS.md.

## Layout

```
src/pipeline/   pure ported core (ingest, identity, crosswalk, rollups, resolve)
src/server/     Hono Worker: db.ts (D1), service.ts (views), index.ts (routes)
src/web/        React SPA: pages/{ThisWeek,Month,Stakes,Trends,Chase,Import,Admin}
src/shared/     KI vocabulary shared by server + web
migrations/     D1 schema
scripts/        gen_oracle.py, seed_local.ts
samples/        12 real IMOS weeks (2026-06-01 … 08-24)
test/           vitest + oracle fixtures
```
