-- The Chase list needs "did this area touch its numbers during THIS reporting
-- week", not just the latest modified date. IMOS history[] entries carry a
-- `week` field equal to reportStart when the entry belongs to that week.
ALTER TABLE area_history ADD COLUMN updated_this_week INTEGER NOT NULL DEFAULT 0;
