-- Any column on the Baptisms (MLC) sheet the portal does not map to a named
-- field arrives as {header: value} and is kept here verbatim, so a new column
-- the STLs add shows up in the portal (and can be put on the stake report)
-- without a code change.
ALTER TABLE friend ADD COLUMN extra_json TEXT;
