-- DCSM KI Portal — initial schema.
-- Mirrors ki-pipeline/pipeline/db.py (import_run, ki_fact, ward_fact,
-- missionary_snapshot, canonical_area, area_crosswalk, area_ward) and adds
-- area_history (chase list), friend + friend_status (on-date tracking),
-- directory_person (the one external read), config, and audit_log.

-- Raw IMOS payloads, immutable. A re-import of the identical bytes is a no-op.
CREATE TABLE import_run (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start    TEXT NOT NULL,
  week_end      TEXT NOT NULL,
  imported_at   TEXT NOT NULL,
  imported_by   TEXT,
  source_sha256 TEXT NOT NULL,
  raw_json      TEXT NOT NULL,
  UNIQUE (week_start, source_sha256)
);

CREATE TABLE ki_fact (
  import_run_id    INTEGER NOT NULL REFERENCES import_run(id),
  week_start       TEXT NOT NULL,
  imos_zone_id     INTEGER,
  imos_zone_name   TEXT,
  imos_district_id INTEGER,
  imos_district_name TEXT,
  imos_area_id     INTEGER NOT NULL,
  imos_area_name   TEXT NOT NULL,
  ki_id            INTEGER NOT NULL,
  goal             INTEGER,
  actual           INTEGER NOT NULL DEFAULT 0,
  is_mlc           INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (week_start, imos_area_id, ki_id)
);
CREATE INDEX ix_ki_fact_week ON ki_fact (week_start);
CREATE INDEX ix_ki_fact_zone ON ki_fact (week_start, imos_zone_name);

CREATE TABLE ward_fact (
  week_start   TEXT NOT NULL,
  imos_area_id INTEGER NOT NULL,
  org_id       INTEGER NOT NULL,
  org_name     TEXT NOT NULL,
  ki_id        INTEGER NOT NULL,
  actual       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (week_start, imos_area_id, org_id, ki_id)
);
CREATE INDEX ix_ward_fact_week ON ward_fact (week_start);

CREATE TABLE missionary_snapshot (
  week_start    TEXT NOT NULL,
  missionary_id INTEGER NOT NULL,
  first_name    TEXT,
  last_name     TEXT,
  imos_area_id  INTEGER,
  position      TEXT,
  PRIMARY KEY (week_start, missionary_id)
);
CREATE INDEX ix_missionary_week ON missionary_snapshot (week_start);

-- When each area's numbers were last touched in IMOS — feeds the Chase list.
CREATE TABLE area_history (
  week_start     TEXT NOT NULL,
  imos_area_id   INTEGER NOT NULL,
  imos_area_name TEXT NOT NULL,
  modified_date  TEXT,
  PRIMARY KEY (week_start, imos_area_id)
);

-- ---- identity / crosswalk -------------------------------------------------
CREATE TABLE canonical_area (
  canonical_area_key TEXT PRIMARY KEY,
  display_name       TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  retired_at         TEXT
);

CREATE TABLE area_crosswalk (
  imos_area_id       INTEGER NOT NULL,
  canonical_area_key TEXT NOT NULL REFERENCES canonical_area,
  valid_from         TEXT NOT NULL,
  valid_to           TEXT,
  note               TEXT,
  PRIMARY KEY (imos_area_id, valid_from)
);

CREATE TABLE area_ward (
  canonical_area_key TEXT NOT NULL REFERENCES canonical_area,
  ward_unit_id       INTEGER NOT NULL,
  ward_name          TEXT NOT NULL,
  stake              TEXT NOT NULL,
  valid_from         TEXT NOT NULL,
  valid_to           TEXT,
  PRIMARY KEY (canonical_area_key, ward_unit_id, valid_from)
);

-- ---- friends / on-date (STL-maintained; not in IMOS) --------------------
CREATE TABLE friend (
  id                 TEXT PRIMARY KEY,
  canonical_area_key TEXT,
  ward               TEXT,
  stake              TEXT,
  name               TEXT NOT NULL,
  on_date            TEXT,
  baptism_date       TEXT,
  missionaries       TEXT,
  created_at         TEXT NOT NULL,
  updated_by         TEXT,
  updated_at         TEXT,
  active             INTEGER NOT NULL DEFAULT 1
);

-- One row per friend per reporting week — the carry-forward snapshot.
CREATE TABLE friend_status (
  friend_id           TEXT NOT NULL REFERENCES friend(id),
  week_start          TEXT NOT NULL,
  on_date             TEXT,
  baptism_date        TEXT,
  attended_church_2x  INTEGER NOT NULL DEFAULT 0,
  on_baptism_calendar INTEGER NOT NULL DEFAULT 0,
  baptized_confirmed  INTEGER NOT NULL DEFAULT 0,
  active              INTEGER NOT NULL DEFAULT 1,
  updated_by          TEXT,
  updated_at          TEXT,
  PRIMARY KEY (friend_id, week_start)
);
CREATE INDEX ix_friend_status_week ON friend_status (week_start);

-- ---- directory (the single external read: DCSM Contacts) ---------------
CREATE TABLE directory_person (
  synced_at TEXT NOT NULL,
  name      TEXT,
  position  TEXT,
  area      TEXT,
  email     TEXT,
  phone     TEXT,
  kind      TEXT
);

CREATE TABLE config (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT NOT NULL,
  actor       TEXT,
  action      TEXT NOT NULL,
  detail_json TEXT
);
