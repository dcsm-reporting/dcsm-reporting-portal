# Longevity

Everything that makes this portal live longer, in one place. The code will
outlast the people running it; the things on this page are what keep the
people able to run it. Written 2026-09-03. Add to it.

## 1. The habits that matter most

1. **Monday: open the Console.** Every anomaly the portal can detect shows up
   there in plain language with a link to the fix. If that habit survives
   handovers, the system does.
2. **Thirty minutes at every handover.** The departing office missionary walks
   the incoming one through the Console, Import, Rollover, Publish, and
   `docs/transfers.md`. The old SOP did this for the sheets; keep doing it
   for the portal.
3. **Once a quarter, sign into the role Gmail** (`dcsm.reporting@gmail.com`)
   itself, not just Cloudflare or GitHub with it. Google may delete an
   account that has not been signed into for two years, and that address is
   the recovery path for both the Cloudflare and GitHub accounts.

## 2. Credentials and accounts (the mission vault)

| Account | Why it matters | Recovery |
|---|---|---|
| Role Gmail `dcsm.reporting@gmail.com` + 2FA recovery codes | Owns everything below | The recovery codes are the only fallback if the phone is lost |
| Cloudflare (Workers, D1, KV, Access) | Hosts the portal and the data | Signs in with the role Gmail |
| GitHub `dcsm-reporting/dcsm-reporting-portal` | The code and, once armed, the weekly database backup | Signs in with the role Gmail; Noah added as admin collaborator |
| `FRIENDS_SYNC_SECRET` | Lets the Baptisms sheet push to the portal | Rotate any time with `wrangler secret put`; paste the new value into the sheet's Script Properties |
| Access AUD tag | Needed only if the token check is turned on | Zero Trust → Access → Applications |

Nothing else. No personal account is load-bearing.

## 3. Five-minute items still open (do them)

- **Set the viewer list** (Admin → Admin access → Who can view). Until it is
  set, any @missionary.org account in any mission can sign in and see
  friends' and new members' names. See `docs/privacy.md`.
- **Arm the weekly backup**: two GitHub Actions secrets
  (`CLOUDFLARE_API_TOKEN` with D1 Edit, `CLOUDFLARE_ACCOUNT_ID`). Then a
  SQL dump lands in the repository every Monday without anyone remembering.
- **Turn on the Access token check**: `docs/access-token-check.md`.
- **Push every commit to GitHub.** The repository is the second copy of the
  code; the Worker is not a backup of itself.

## 4. What can be changed without a developer

All of these are settings in the browser, take effect immediately, and are
validated on save so a mistake cannot take the portal down.

| Change | Where |
|---|---|
| Which sections the stake-president report contains, their order, which indicators, how many trend weeks, how many months of baptisms, headline tiles, an intro paragraph, a closing note | Admin → Stake reports → What the report contains |
| The cover email's wording, subject, CC list, each stake's recipients and president | Admin → Stake reports |
| A ward moving stake, a new stake, a ward renamed, a branch becoming a ward, a ward dissolved, a stake renamed | Admin → Areas & wards → quick actions |
| New, split, merged, renamed teaching areas; new wards IMOS starts reporting | Admin → Rollover (suggestions pre-filled) |
| Which missionary positions make an MLC area, zone display order, zones excluded from mission totals, colour thresholds, expected active-area range | Admin → Reporting settings |
| Who is an admin | Admin → Admin access |
| Which tabs and columns the Baptisms sheet sync reads | The header-name table at the top of `apps_script/baptisms-sync.gs` (plain text, no code beyond the list) |

## 5. What needs a developer (or an AI session with the repository)

Each of these is a contained change with tests around it. Say what changed
and point at the file.

| Change | File | Size |
|---|---|---|
| IMOS renames a field, changes the tree shape, or the Church replaces IMOS | `src/pipeline/readImos.ts` (+ `test/oracle` if the numbers should still match the Python) | a day |
| A seventh Key Indicator the mission wants to report on | `src/shared/ki.ts` (id, code, name); every grid follows | an hour |
| A new *kind* of section on the stake report (a chart, a different table) | `src/shared/reportLayout.ts` (id + label) and `renderSection` in `src/web/publish/stakeReport.tsx` | half a day |
| A new board layout for the Monday deck | `src/web/publish/boards.tsx` | half a day |
| Zone renames that should keep one trend line across the rename (a zone alias table) | `src/server/config.ts` + `src/pipeline/rollup.ts` | half a day |
| Missionary email domain changes | Not code: Zero Trust → Access policy | minutes |

## 6. Dependency policy: freeze it

- **Do not upgrade dependencies because they are old.** The lockfile pins
  every version; the Worker's `compatibility_date` pins the runtime. Upgrading
  is the most common way a working system stops building.
- Upgrade only when a deploy fails on a fresh machine, and then one package at
  a time with `npm test` and `npm run typecheck` between.
- The `wrangler` "out of date" warning is noise. It has printed on every run
  since the first deploy and nothing depends on the newer version.
- Node 20 or later. Keep the version that last deployed successfully written
  in `STATUS.md`.

## 7. Data: what grows, what does not

Ten years of imports fit in the free tier (`docs/anomalies.md`, "Data growth
over years"). Raw IMOS payloads are the audit trail and should never be
pruned. The sheet-sync log prunes itself. Three independent copies of the
database exist once the backup cron is armed: Cloudflare's 30-day time
travel, the weekly SQL dump in git, and the admin JSON export. Restore
procedure: `docs/backup.md`.

## 8. When the Church changes IMOS

This is the most likely event to force a code change, on a two- to four-year
horizon. The playbook:

1. Imports start failing with a validation message naming what is missing.
   Nothing already stored is affected; every report keeps working on the
   stored weeks.
2. Save a payload from the new system into `samples/` under its week.
3. Port `src/pipeline/readImos.ts` to the new shape. The rest of the pipeline
   reads `KiFact` rows and does not care where they came from.
4. Run `npm test`. The oracle tests will fail on the new sample (the Python
   reference does not know the new shape); everything else must pass.
5. Deploy. Total: about a day for someone who can read TypeScript, or an
   afternoon with an AI session pointed at the repository.

If the Church stops exposing the report JSON at all, the fallback is a paste
of whatever export it does offer, parsed the same way. The import page,
validation, and every downstream view stay as they are.

## 9. Things deliberately not built

- Nothing sends email or messages on its own. A person sends every report.
- Nothing logs into IMOS. The JSON is pasted by hand.
- No second database, no second cloud. One account, one repository.
- No dependency on any personal account or any individual's machine.

These are not gaps. They are the reasons the previous systems lasted under a
year and this one is expected to last several.

## 10. Yearly check (fifteen minutes, first Monday of the year)

- [ ] Role Gmail signs in; 2FA recovery codes are in the vault.
- [ ] Cloudflare and GitHub sign in with it.
- [ ] The weekly backup committed last Monday (GitHub → `backups/`).
- [ ] `STATUS.md` says which Node version last deployed; a fresh `npm ci && npm test` passes on the office machine.
- [ ] Admin → Admin access lists current people only.
- [ ] Access policy still matches the missionary email domains.
- [ ] This page still describes reality; fix it if not.

## 11. One rule for whoever edits the code

**When an `/api/*` response changes shape, bump that route's cache key**
(`"structure:v2"` → `"structure:v3"` in `src/server/index.ts`). Views are served
from the KV cache and a deploy does not invalidate it, so a page can otherwise
read yesterday's shape and crash with "cannot read properties of undefined".
This has happened twice (Trends, Areas & wards). The client should also treat
new fields as optional for the first hour after a deploy.
