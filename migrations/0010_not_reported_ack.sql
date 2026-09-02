-- Acknowledgements for the "Not reported" list: an area flagged as not having
-- entered its weekly numbers can be dismissed with a reason so it stops showing
-- as needing attention. Keyed by (week, imos area) so it only applies to that
-- week; when the area actually reports it drops off the stale list and the ack
-- is simply ignored.
CREATE TABLE IF NOT EXISTS not_reported_ack (
  week_start   TEXT NOT NULL,
  imos_area_id INTEGER NOT NULL,
  reason       TEXT,
  acked_at     TEXT NOT NULL,
  acked_by     TEXT,
  PRIMARY KEY (week_start, imos_area_id)
);
