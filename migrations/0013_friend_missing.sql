-- Transfer-week churn on the Baptisms (MLC) sheet: STLs delete a friend from
-- one zone tab and re-add them on another, often hours apart. An on-date
-- friend who vanishes is no longer dropped on the spot; the moment they went
-- missing is stamped here and they are dropped only after a grace period of
-- continuous absence. Cleared the moment they reappear on any tab.
ALTER TABLE friend ADD COLUMN missing_since TEXT;
