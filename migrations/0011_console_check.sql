-- Manual check-offs for the Weekly console checklist. Keyed by (week, step) so
-- the list resets every time a new week becomes the latest import. The derived
-- state (done / attention / todo) is still computed from live data; a check row
-- just records "I've handled this for this week".
CREATE TABLE IF NOT EXISTS console_check (
  week_start TEXT NOT NULL,
  step_id    TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  checked_by TEXT,
  PRIMARY KEY (week_start, step_id)
);
