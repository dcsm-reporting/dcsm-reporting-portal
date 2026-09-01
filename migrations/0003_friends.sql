-- Friends / on-date tracking — the STL-maintained names that IMOS doesn't carry.
-- Mirrors the "Baptisms (MLC)" Google Sheet: an Apps Script bound to that sheet
-- pushes a full snapshot to POST /api/friends/sync, which upserts here. The
-- portal shows this read-only. Two states only, per the sheet: on a baptismal
-- date, or baptized & confirmed.
--
-- The 0001 stubs (friend / friend_status) were never used; replaced here.

DROP TABLE IF EXISTS friend_status;
DROP TABLE IF EXISTS friend;

CREATE TABLE friend (
  id                  TEXT PRIMARY KEY,          -- uuid
  name                TEXT NOT NULL,
  zone                TEXT,                       -- reporting zone (from the sheet / area)
  canonical_area_key  TEXT,                       -- resolved from ward where possible
  ward                TEXT,
  stake               TEXT,
  missionaries        TEXT,                       -- free text, e.g. "Elders Zhou & Lake"
  baptism_date        TEXT,                       -- scheduled or actual, YYYY-MM-DD
  baptism_time        TEXT,                       -- "2:15 PM" / "TBD"
  baptism_address     TEXT,
  attended_church_2x  INTEGER NOT NULL DEFAULT 0,
  on_baptism_calendar INTEGER NOT NULL DEFAULT 0,
  baptized_confirmed  INTEGER NOT NULL DEFAULT 0, -- the sheet's "Completed Baptism"
  dropped             INTEGER NOT NULL DEFAULT 0, -- had a date, fell through
  active              INTEGER NOT NULL DEFAULT 1, -- still present in the sheet's last sync
  source              TEXT NOT NULL DEFAULT 'sheet',   -- 'sheet' | 'portal'
  sync_key            TEXT,                       -- stable-ish natural key: zone|ward|name
  created_at          TEXT NOT NULL,
  created_by          TEXT,
  updated_at          TEXT NOT NULL,
  updated_by          TEXT
);
CREATE INDEX ix_friend_zone  ON friend (zone);
CREATE INDEX ix_friend_stake ON friend (stake);
CREATE INDEX ix_friend_bd    ON friend (baptism_date);
CREATE INDEX ix_friend_live  ON friend (active, baptized_confirmed, dropped);
CREATE UNIQUE INDEX ux_friend_sync_key ON friend (sync_key) WHERE sync_key IS NOT NULL;

-- One row per friend per reporting week — a weekly snapshot taken at sync time,
-- so the stake reports can show "on date as of week X" and 12-week trends.
CREATE TABLE friend_week (
  friend_id           TEXT NOT NULL REFERENCES friend(id),
  week_start          TEXT NOT NULL,
  baptism_date        TEXT,
  attended_church_2x  INTEGER NOT NULL DEFAULT 0,
  on_baptism_calendar INTEGER NOT NULL DEFAULT 0,
  baptized_confirmed  INTEGER NOT NULL DEFAULT 0,
  dropped             INTEGER NOT NULL DEFAULT 0,
  captured_at         TEXT NOT NULL,
  PRIMARY KEY (friend_id, week_start)
);
CREATE INDEX ix_friend_week_week ON friend_week (week_start);

-- When the sheet last pushed, and what happened.
CREATE TABLE friend_sync (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT NOT NULL,
  rows_in     INTEGER NOT NULL,
  upserted    INTEGER NOT NULL,
  deactivated INTEGER NOT NULL,
  warnings    TEXT
);
