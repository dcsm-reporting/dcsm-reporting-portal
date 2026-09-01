-- STLs cycle completed baptisms out of the Baptisms (MLC) working tabs each
-- month. The portal should keep them: a confirmed baptism that leaves the sheet
-- is retained (left_sheet_at stamped, still active), while an on-date friend
-- that leaves is treated as dropped. left_sheet_at is cleared if they reappear.
ALTER TABLE friend ADD COLUMN left_sheet_at TEXT;

-- sync_key drops the zone (which is renamed at transfers) so working-tab and
-- history-tab rows for the same person reconcile on ward|name.
UPDATE friend SET sync_key = lower(coalesce(ward, '') || '|' || name) WHERE source = 'sheet';
