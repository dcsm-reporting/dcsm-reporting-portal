-- The old Baptisms (MLC) sheet never date-stamped a completion — the baptism
-- date column did double duty. confirmed_at records the first sync that saw the
-- "Completed Baptism" box ticked, so the durable table has an audit trail of
-- when each baptism entered the record.
ALTER TABLE friend ADD COLUMN confirmed_at TEXT;
UPDATE friend SET confirmed_at = updated_at WHERE baptized_confirmed = 1 AND confirmed_at IS NULL;
