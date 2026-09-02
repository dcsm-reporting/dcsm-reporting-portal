-- sync_key becomes informational only. Matching is done in memory each sync
-- (ward|name|date, with a ward|name reschedule fallback), so the unique index
-- was only a failure mode — a reschedule or a genuine name+ward+date twin could
-- trip it. Drop it; keep the column for debugging.
DROP INDEX IF EXISTS ux_friend_sync_key;
