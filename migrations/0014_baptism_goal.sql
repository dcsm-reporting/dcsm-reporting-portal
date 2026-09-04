-- Optional baptism goals: one row per period per zone. period is 'YYYY-MM'
-- (a month) or 'YYYY' (the year); zone '' is the mission. No rows = no goals,
-- and nothing about goals shows anywhere. Any month, past or future, can be
-- set or changed at Admin → Baptism goals.
CREATE TABLE baptism_goal (
  period     TEXT NOT NULL,
  zone       TEXT NOT NULL DEFAULT '',
  goal       INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  PRIMARY KEY (period, zone)
);
