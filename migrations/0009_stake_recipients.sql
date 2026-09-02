-- Who each stake-president report goes to. Seeded from the old
-- "Stake President Reports 2.0" → EMAILS sheet; editable in Admin.
CREATE TABLE stake_recipients (
  stake            TEXT PRIMARY KEY,   -- canonical stake name (matches area_ward.stake)
  president_name   TEXT,
  to_emails        TEXT,               -- comma-separated
  cc_emails        TEXT,               -- comma-separated
  updated_at       TEXT,
  updated_by       TEXT
);

-- A CC list applied to every stake report (secretaries, mission presidency…).
INSERT INTO config (key, value_json) VALUES ('report_cc_all', '[]')
  ON CONFLICT (key) DO NOTHING;
