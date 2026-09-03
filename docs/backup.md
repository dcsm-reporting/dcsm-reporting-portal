# Backups & recovery

The portal is the mission's reporting system of record, so its data needs to be
recoverable. There are three independent copies you can fall back on, cheapest
first.

## 1. Cloudflare's own point-in-time recovery (nothing to set up)

D1 keeps a rolling change history. From any machine that is `wrangler login`-ed
on the account:

```bash
npx wrangler d1 time-travel info dcsm_ki --remote          # current bookmark
npx wrangler d1 time-travel restore dcsm_ki --remote --timestamp "2026-08-01T00:00:00Z"
```

Retention is 30 days on the current plan. This covers "someone ran a bad
migration this morning" — it does **not** cover the account going away.

## 2. On-demand SQL dump (`scripts/backup.sh`)

```bash
scripts/backup.sh
```

Writes `backups/dcsm_ki-YYYY-MM-DD.sql` (full schema + data), keeps the last 12,
prunes older ones. Run it before any migration or bulk load. Rebuild from one
into a fresh database with:

```bash
npx wrangler d1 create dcsm_ki_restore
npx wrangler d1 execute dcsm_ki_restore --remote --file backups/dcsm_ki-2026-09-01.sql
```

then point `wrangler.toml`'s `database_id` at the new one.

`backups/` is git-ignored for local runs; commit a dump by hand if you want it
in history (`git add -f backups/<file>.sql`).

## 3. Weekly automated dump to git (`.github/workflows/backup.yml`)

Dormant until this repo has a GitHub remote. To turn it on:

1. Push the repo to GitHub.
2. Add two Actions secrets (Settings → Secrets and variables → Actions):
   - `CLOUDFLARE_API_TOKEN` — [create one](https://dash.cloudflare.com/profile/api-tokens)
     with permission **Account › D1 › Edit**.
   - `CLOUDFLARE_ACCOUNT_ID` — Workers & Pages → right sidebar.
3. The workflow then runs every Monday 09:17 UTC and on demand (Actions tab →
   "D1 backup" → Run workflow), committing `backups/dcsm_ki-<date>.sql` and
   keeping the newest 12.

## 4. Self-serve JSON export (in the app)

**Admin → Data → Download full backup (JSON)** hits `/api/export`, which
streams every table (16 as of migration 0011, including `console_check`) as
one JSON file. It is admin-only (it is the whole system in one file) and is
streamed table by table in row pages, so it stays within Worker memory however
large the raw-payload history grows. It's the "email myself a copy" option —
handy, human-readable — but not a schema backup: prefer #2/#3 for real
recovery.

## What to do before a migration or bulk load

```bash
scripts/backup.sh            # dump first
# ...run the migration/load...
npx wrangler d1 execute dcsm_ki --remote --command "SELECT count(*) FROM ki_fact"   # sanity check
```

If it goes wrong, `time-travel restore` to just before, or rebuild from the dump.
