# WDCSM Reporting

Weekly Key Indicators reporting for the Washington DC South Mission. One web
app: React in the browser, a Cloudflare Worker for the API, D1 (SQLite) for
the data, Cloudflare Access for sign-in. Free to run, owned by a role account.

## Read this first

| Page | What it answers |
|---|---|
| `STATUS.md` | What is live right now, what is still open |
| `ARCHITECTURE.md` | How it is built and why |
| `docs/longevity.md` | The habits, accounts and yearly check that keep it running |
| `docs/anomalies.md` | What the portal does, and what a person does, when something unusual happens |
| `docs/transfers.md` | Transfer week, day by day |
| `docs/how-mapping-works.md` | Areas, units, stakes, and why transfers do not break it |
| `docs/friends-sheet-bridge.md` | The Baptisms (MLC) sheet sync |
| `docs/slides-deck.md` | The Monday MLC Slides deck |
| `docs/api.md` | Every API route, for anyone building on the portal |
| `docs/backup.md` | Backups and recovery |
| `docs/privacy.md` | Church data-privacy assessment |
| `docs/access-token-check.md` | Optional hardening of sign-in |
| `NEXT.md` | Ideas not yet built |

## Run it locally

```bash
npm install
npm run db:migrate:local     # create the local D1 database
npm run build                # build the SPA that wrangler dev serves
npm run dev:api              # http://localhost:8787
npm run seed:local           # 12 sample weeks + the crosswalk
```

`.dev.vars` (git-ignored) needs `DEV_USER`, `FRIENDS_SYNC_SECRET`, and
`SLIDES_READ_SECRET` for the local server. For UI work with hot reload run
`npm run dev` alongside `npm run dev:api`.

## Test and deploy

```bash
npm test                     # 117 tests, including the diff against the Python reference
npm run typecheck
npm run db:migrate:remote    # only when migrations/ gained a file
npm run deploy
```

Apply a new migration to production **before** deploying code that reads the
new column. Bump a route's cache key when its response shape changes
(`docs/longevity.md` §11).

## Layout

```
src/pipeline/    pure reporting core (ingest, identity, mapping, rollups, rollover)
src/server/      Hono Worker: routes, D1 access, views, publish, sheet sync, slides feed
src/web/         React SPA
src/shared/      indicator vocabulary, dates, report layout (server + web)
apps_script/     the two Google Apps Scripts (Baptisms sheet sync, Slides deck)
migrations/      D1 schema, applied in order
resources/       Area To Ward Key, unit directory, stake recipients (source workbooks are git-ignored)
samples/         12 real IMOS weeks used by the tests
scripts/         oracle generator, local seed, backup
test/            vitest, incl. the Python oracle diff
docs/            the pages listed above
```

The Python at `../ki-pipeline/` is the specification and test oracle for the
pipeline. It is not deployed.
