# Monday MLC Slides deck

The Google Slides decks shown at MLC (one weekly, one 4-week) are drawn by an
Apps Script, `apps_script/slides-refresh.gs`. Since 2026-09-03 the script gets
its numbers from the portal instead of the retired reporting sheets:

| On the slides | Comes from |
|---|---|
| Zone and mission indicator tiles, this week and 4-week | `GET /api/slides/weekly` and `/monthly` on the portal |
| MLC share (mission total vs MLC areas, this week and last) | the same call |
| Zone order, which zones are excluded | the portal (Admin → Reporting settings) |
| "Has a baptismal date" roster and the monthly goal chip on each zone slide | the Baptisms (MLC) sheet, read directly by the script, one tab per zone |

The feed carries numbers only. No names leave the portal this way.

## What the feed returns

`src/server/slides.ts` builds it. Deck codes are the ones the slides always
used (BC, BD, SAC, NP, LWM, RCA); the portal's own codes stay internal.

```json
{
  "mode": "weekly",
  "week": "2026-08-24",
  "subtitle": "Week of 8/24",
  "zones": [{ "name": "Alexandria", "kis": { "BC": { "goal": 2, "actual": 1 }, "...": {} }, "detail": null }],
  "mission": { "BC": { "goal": 20, "actual": 8 }, "...": {} },
  "mlc": { "thisWeek": { "BC": { "goal": 8, "actual": 3 } }, "lastWeek": { "...": {} } },
  "window": ["2026-08-24"],
  "notes": ["WARNING: the latest imported week is Week of 8/24; ..."]
}
```

- `weekly` is the latest imported week; `?week=YYYY-MM-DD` picks another.
- `monthly` sums the four most recent imported weeks up to that week and adds
  `detail` (one entry per week, oldest first) for the per-zone 4-week grids.
- `mlc.*[code].goal` is the mission total and `.actual` the MLC areas, which
  is how the old LeadershipKIs sheet was laid out and how the MLC slide reads it.
- `notes` are cautions for the script's log: the latest week is not the last
  complete week, a week inside the 4-week window was never imported, no
  earlier week exists for the LAST WEEK block.

## One-time setup

### 1. The read secret

Set as a Worker secret (`SLIDES_READ_SECRET`) on 2026-09-03. To rotate it:

```bash
npx wrangler secret put SLIDES_READ_SECRET
```

Then paste the new value into the script's `SLIDES_SECRET` property (step 3).

### 2. Let the feed through Cloudflare Access

The script is not a logged-in user, so `/api/slides/*` must skip the Access
login, the same way `/api/friends/sync` does:

1. Zero Trust → **Access → Applications → Add an application → Self-hosted**.
2. Domain: `dcsm-ki-portal.dcsm-reporting.workers.dev`, **Path**: `api/slides`.
3. Policy: Action **Bypass**, Include **Everyone**.
4. Save. Only that path prefix is open, and it still requires the bearer
   secret; every other page keeps the login.

Until this exists the script fails with a clear message ("Cloudflare Access is
in the way: add a Bypass rule for the path api/slides").

### 3. The Apps Script

1. Open the Slides script project (the one bound to the MLC decks) and
   replace its code with `apps_script/slides-refresh.gs`.
2. Project Settings → **Script Properties**:
   - `PORTAL_URL` = `https://dcsm-ki-portal.dcsm-reporting.workers.dev`
   - `SLIDES_SECRET` = the `SLIDES_READ_SECRET` value
3. Run `dumpPortal()` once from the editor. It authorizes `UrlFetchApp` and
   prints the numbers the portal returned. Then `dryRun()` previews every
   slide without writing anything.
4. `refreshWeekly()` and `refreshMonthly()` draw the decks as before.

Nothing else in the script changed: the drawing engine, the roster reader,
and the Social Media slide pinning are as they were. The old sheet ids,
column layouts, `ZONE_ORDER`, and `ZONE_EXCLUDE` are gone; the portal
decides those now.

## Monday

1. Import the week in the portal (Console says when it is in).
2. Run `refreshWeekly()`; on the first Monday of the month also
   `refreshMonthly()`.
3. Read the execution log. A `WARNING:` line means the deck was drawn from
   an older week or a window with a gap; fix the import and run again.

To rebuild a past week's deck, set `SRC.WEEK` in the script to that Monday,
run, and blank it again.

## When things change

| Change | What to do |
|---|---|
| A zone is added, renamed, or dropped at transfers | Nothing in the script. Add or rename the zone's "[Zone] Formatting" tab in Baptisms (MLC) so its roster is found; the log names any zone without a tab and any tab without a zone. |
| The portal moves to a new address | Change `PORTAL_URL` in Script Properties. |
| The secret leaks | Rotate it (step 1), update `SLIDES_SECRET`. |
| The deck should show a seventh indicator | Add it to `src/shared/ki.ts` (`KI_DECK_LABEL`) and to `SRC.KIS` in the script; the grids follow. |

## Testing without Google

The feed is covered by the e2e smoke test in the session scratchpad
(`smoke-slides.mjs`): it checks auth, the shape, agreement with the Publish
boards, then loads the real `.gs` file under Node with `UrlFetchApp`,
`SpreadsheetApp`, and `PropertiesService` stubbed and runs the script's own
`buildSpecs_()` and `dryRun()`. That is how the script was verified before
being pasted into Google.
