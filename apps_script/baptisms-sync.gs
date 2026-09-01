/**
 * DCSM KI Portal — Baptisms (MLC) sheet → portal bridge.
 *
 * Bind this to the "Baptisms (MLC)" spreadsheet (Extensions → Apps Script),
 * set the two Script Properties below, add a time-driven trigger on
 * `pushToPortal` (every 15 min is plenty), and the portal's Friends page will
 * mirror the sheet. The sheet stays the place STLs actually edit.
 *
 *   Script Properties (Project Settings → Script Properties):
 *     PORTAL_URL    https://dcsm-ki-portal.dcsm-reporting.workers.dev
 *     SYNC_SECRET   (the same value set with `wrangler secret put FRIENDS_SYNC_SECRET`)
 */

// Per-zone tabs to read. Any name here that isn't a real tab is skipped.
var ZONE_TABS = [
  'Alexandria', 'Annandale', 'Bull Run', 'Langley', 'Loudoun',
  'Manassas', 'McLean', 'Oakton', 'Potomac', 'Woodbridge',
  'Bella Vista North'
];

var HEADER_MATCH = 'name (first and last)';

// column label (lowercased, trimmed) → payload field
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
  'missionary names (last name + last name)': 'missionaries',
  'missionary names': 'missionaries',
  'completed baptism': 'baptizedConfirmed'
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('KI Portal')
    .addItem('Push to portal now', 'pushToPortal')
    .addToUi();
}

function mostRecentMonday_() {
  var d = new Date();
  d.setHours(0, 0, 0, 0);
  var dow = d.getDay();            // 0 = Sun
  var back = dow === 0 ? 7 : dow;  // days back to the most recent past Sunday
  d.setDate(d.getDate() - back - 6);  // that Sunday, then its Monday (−6)
  return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
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

function collectRows_() {
  var ss = SpreadsheetApp.getActive();
  var tz = ss.getSpreadsheetTimeZone() || 'America/New_York';
  var out = [];
  for (var z = 0; z < ZONE_TABS.length; z++) {
    var sheet = ss.getSheetByName(ZONE_TABS[z]);
    if (!sheet) continue;
    var values = sheet.getDataRange().getValues();

    // find the header row
    var hdrRow = -1;
    for (var i = 0; i < values.length; i++) {
      for (var j = 0; j < values[i].length; j++) {
        if (String(values[i][j] || '').trim().toLowerCase() === HEADER_MATCH) { hdrRow = i; break; }
      }
      if (hdrRow >= 0) break;
    }
    if (hdrRow < 0) continue;

    var cols = {};
    for (var c = 0; c < values[hdrRow].length; c++) {
      var key = String(values[hdrRow][c] || '').trim().toLowerCase();
      if (FIELD_BY_HEADER[key]) cols[FIELD_BY_HEADER[key]] = c;
    }
    if (cols.name === undefined) continue;

    for (var r = hdrRow + 1; r < values.length; r++) {
      var name = String(values[r][cols.name] || '').trim();
      if (!name) continue;
      var rec = { zone: ZONE_TABS[z], name: name };
      for (var field in cols) {
        if (field === 'name') continue;
        var raw = values[r][cols[field]];
        if (field === 'baptismDate') rec.baptismDate = raw ? isoDate_(raw) : '';
        else if (field === 'baptismTime') rec.baptismTime = timeStr_(raw, tz);
        else if (field === 'baptizedConfirmed') rec.baptizedConfirmed = /^(y|yes|true|1)/i.test(String(raw).trim());
        else if (field === 'attendedChurch2x' || field === 'onBaptismCalendar')
          rec[field] = /^(y|yes|true|1)/i.test(String(raw).trim());
        else rec[field] = String(raw == null ? '' : raw).trim();
      }
      out.push(rec);
    }
  }
  return out;
}

function pushToPortal() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('PORTAL_URL');
  var secret = props.getProperty('SYNC_SECRET');
  if (!url || !secret) throw new Error('Set PORTAL_URL and SYNC_SECRET in Script Properties.');

  var payload = { weekStart: mostRecentMonday_(), rows: collectRows_() };
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
