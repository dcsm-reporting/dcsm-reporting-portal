-- Row-read reduction.
--
-- ix_ki_fact_area supports per-area lookups (the Areas page's "latest name"
-- and the rollover "areas present last week" query) so they seek instead of
-- scanning the whole table. The correlated subquery in latestAreaNames was
-- rewritten to a single GROUP BY in the same change.
CREATE INDEX IF NOT EXISTS ix_ki_fact_area ON ki_fact (imos_area_id, week_start);
CREATE INDEX IF NOT EXISTS ix_ward_fact_area ON ward_fact (imos_area_id);
