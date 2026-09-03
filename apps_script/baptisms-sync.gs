/**
 * DCSM KI Portal — Baptisms (MLC) sheet → portal bridge.
 *
 * Bind this to the "Baptisms (MLC)" spreadsheet (Extensions → Apps Script),
 * set the two Script Properties below, add a time-driven trigger on
 * `pushToPortal` (every 15 min is plenty), and the portal's Baptisms page will
 * mirror the sheet. The sheet stays the place STLs actually edit.
 *
 * The onEdit() trigger below needs no separate setup — it's a simple trigger,
 * Apps Script wires it up automatically because it's named exactly `onEdit`.
 * It just timestamps the last edit so pushToPortal() can skip a run that
 * would land mid-edit (a sort or a multi-row move can leave things briefly
 * inconsistent); it tries again on the next 15-minute tick. The portal's own
 * sync also has a circuit breaker for anything that slips through.
 *
 *   Script Properties (Project Settings → Script Properties):
 *     PORTAL_URL    https://dcsm-ki-portal.dcsm-reporting.workers.dev
 *     SYNC_SECRET   (the same value set with `wrangler secret put FRIENDS_SYNC_SECRET`)
 */

// Tabs are AUTO-DISCOVERED: any tab containing the header row below is read.
// No hardcoded zone list to update at a transfer. For a working per-zone tab
// the zone is the tab name; on the tabs listed here the zone comes from an
// "Actual Zone" column instead.
var HISTORY_TABS = ['Organized Baptisms'];

// Tabs to never treat as data even if they somehow match (helpers/config).
var SKIP_TABS = [
  'Dashboard', 'Instructions', 'Last Names', 'Baptisms This Week',
  'Baptisms For Next Week', 'Past Baptisms', 'Area Drop Down Options',
  'ward_stake_key', 'All Units & Addresses'
];

var HEADER_MATCH = 'name (first and last)';

// column label (lowercased, trimmed) → payload field.
// "actual zone" / "actual stake" win over the plain columns when present.
var FIELD_BY_HEADER = {
  'name (first and last)': 'name',
  'baptism date (mm/dd/yy)': 'baptismDate',
  'baptism date': 'baptismDate',
  'address of baptism': 'baptismAddress',
  'time of baptism': 'baptismTime',
  'attended church (y/n)': 'attendedChurch2x',
  'baptism calendar (y/n)': 'onBaptismCalendar',
  'ward name': 'ward',
  'stake': 'stake',
  'actual stake': 'stake',
  'actual zone': 'zone',
  'missionary names (last name + last name)': 'missionaries',
  'missionary names': 'missionaries',
  'completed baptism': 'baptizedConfirmed'
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('KI Portal')
    .addItem('Push to portal now', 'pushToPortalForce')
    .addToUi();
}

/** Menu item: a human clicked it on purpose, so skip the debounce wait. */
function pushToPortalForce() {
  return pushToPortal(true);
}

// A sort, a cut-paste, or a multi-row restructure can leave the sheet briefly
// inconsistent (a name split across two rows, a ward cell blank mid-move). The
// 15-minute timer can land in that window. This is a simple trigger — no setup
// needed beyond the function existing — that just remembers when the sheet was
// last touched, so pushToPortal() can wait for things to settle.
var DEBOUNCE_MS = 2 * 60 * 1000; // 2 minutes since the last edit

function onEdit(e) {
  PropertiesService.getScriptProperties().setProperty('LAST_EDIT_AT', String(Date.now()));
}


var SHEET_ERROR_RE = /^#(REF!|N\/A|VALUE!|DIV\/0!|NAME\?|NUM!|NULL!|ERROR!)$/i;
function isSheetError_(v) {
  return SHEET_ERROR_RE.test(String(v == null ? '' : v).trim());
}

function isoDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'UTC', 'yyyy-MM-dd');
  var s = String(v || '').trim();
  var m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (m) {
    var yy = m[3].length === 2 ? '20' + m[3] : m[3];
    return yy + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
  }
  return s;
}

function timeStr_(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'h:mm a');
  return String(v == null ? '' : v).trim();  // "TBD", "2:00 PM", etc.
}

function readTab_(ss, tabName, fallbackZone, tz, out, seen) {
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) return;
  var values = sheet.getDataRange().getValues();

  var hdrRow = -1;
  for (var i = 0; i < values.length && hdrRow < 0; i++) {
    for (var j = 0; j < values[i].length; j++) {
      if (String(values[i][j] || '').trim().toLowerCase() === HEADER_MATCH) { hdrRow = i; break; }
    }
  }
  if (hdrRow < 0) return;

  var cols = {};
  var extraCols = [];   // [colIndex, headerText] for every column the portal has no named field for
  for (var c = 0; c < values[hdrRow].length; c++) {
    var hdrText = String(values[hdrRow][c] || '').trim();
    var key = hdrText.toLowerCase();
    if (!key) continue;
    if (FIELD_BY_HEADER[key]) {
      if (cols[FIELD_BY_HEADER[key]] === undefined) cols[FIELD_BY_HEADER[key]] = c;
    } else {
      extraCols.push([c, hdrText]);
    }
  }
  if (cols.name === undefined) return;

  for (var r = hdrRow + 1; r < values.length; r++) {
    var name = String(values[r][cols.name] || '').trim();
    // A formula that lost its reference leaves "#REF!" / "#N/A" in the cell;
    // that's never a person. Skip the row here so it never reaches the portal
    // (the portal drops it too, belt and braces).
    if (!name || isSheetError_(name)) continue;
    var rec = { zone: fallbackZone || '', name: name };
    for (var field in cols) {
      if (field === 'name') continue;
      var raw = values[r][cols[field]];
      if (isSheetError_(raw)) raw = '';
      if (field === 'baptismDate') rec.baptismDate = raw ? isoDate_(raw) : '';
      else if (field === 'baptismTime') rec.baptismTime = timeStr_(raw, tz);
      else if (field === 'baptizedConfirmed') rec.baptizedConfirmed = /^(y|yes|true|1)/i.test(String(raw).trim());
      else if (field === 'attendedChurch2x' || field === 'onBaptismCalendar')
        rec[field] = /^(y|yes|true|1)/i.test(String(raw).trim());
      else { var v = String(raw == null ? '' : raw).trim(); if (v) rec[field] = v; }
    }
    // Every other column goes along as {header: value}. A new column the STLs
    // add therefore shows up in the portal on the next sync with no code
    // change; the office can then tick it onto the stake report if wanted.
    var extra = {};
    var hasExtra = false;
    for (var x = 0; x < extraCols.length; x++) {
      var ev = values[r][extraCols[x][0]];
      if (ev == null || ev === '' || isSheetError_(ev)) continue;
      var es = ev instanceof Date ? isoDate_(ev) : String(ev).trim();
      if (!es) continue;
      extra[extraCols[x][1]] = es.slice(0, 200);
      hasExtra = true;
    }
    if (hasExtra) rec.extra = extra;
    // dedupe on ward|name across tabs (working tab wins — it's read first)
    var k = String(rec.ward || '').toLowerCase() + '|' + name.toLowerCase();
    if (seen[k]) continue;
    seen[k] = true;
    out.push(rec);
  }
}

function collectRows_() {
  var ss = SpreadsheetApp.getActive();
  var tz = ss.getSpreadsheetTimeZone() || 'America/New_York';
  var out = [], seen = {};
  var sheets = ss.getSheets();

  // working per-zone tabs first (zone = tab name), so they win the de-dup
  for (var i = 0; i < sheets.length; i++) {
    var nm = sheets[i].getName();
    if (SKIP_TABS.indexOf(nm) >= 0 || HISTORY_TABS.indexOf(nm) >= 0) continue;
    readTab_(ss, nm, nm, tz, out, seen);
  }
  // history tabs after (zone from an "Actual Zone" column)
  for (var h = 0; h < HISTORY_TABS.length; h++) readTab_(ss, HISTORY_TABS[h], '', tz, out, seen);
  return out;
}

function pushToPortal(force) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('PORTAL_URL');
  var secret = props.getProperty('SYNC_SECRET');
  if (!url || !secret) throw new Error('Set PORTAL_URL and SYNC_SECRET in Script Properties.');

  var lastEdit = Number(props.getProperty('LAST_EDIT_AT') || 0);
  if (!force && lastEdit && Date.now() - lastEdit < DEBOUNCE_MS) {
    Logger.log('Skipped: sheet was edited less than ' + (DEBOUNCE_MS / 60000) + ' min ago. Will try again next run.');
    return 'skipped (recent edit)';
  }

  // The portal files the snapshot under the current week itself (its own
  // clock, mission time zone); weekStart is informational only.
  var payload = { rows: collectRows_() };
  var res = UrlFetchApp.fetch(url.replace(/\/+$/, '') + '/api/friends/sync', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + secret },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var body = res.getContentText();
  Logger.log(code + ' ' + body);
  if (code >= 300) throw new Error('portal sync failed: ' + code + ' ' + body);
  return body;
}
