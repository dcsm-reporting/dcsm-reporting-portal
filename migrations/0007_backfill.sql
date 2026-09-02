-- Historical baptism backfill (2025-09 … 2026-08) reconstructed from five
-- partial sources. `confidence` separates the tiers: 'confirmed' = corroborated
-- by a name-level source, 'unverified' = the Zone Leader form only. `notes`
-- carries the reconstruction's triage flags. `source` keeps the granular list
-- of every source that contributed.
ALTER TABLE friend ADD COLUMN confidence TEXT;   -- 'confirmed' | 'unverified' | NULL (sheet-sourced)
ALTER TABLE friend ADD COLUMN notes TEXT;
