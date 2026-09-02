#!/usr/bin/env bash
# Point-in-time backup of the production D1 database.
#
#   scripts/backup.sh                 # writes backups/dcsm_ki-YYYY-MM-DD.sql
#   scripts/backup.sh /some/dir       # writes into that dir instead
#
# Keeps the 12 most recent .sql files in the target dir and deletes older ones.
# `wrangler d1 export` produces a full schema + data dump you can rebuild from
# with `wrangler d1 execute dcsm_ki --file <that file>` (into a fresh DB).
#
# Run it from a machine that is already `wrangler login`-ed as an account with
# access to the dcsm_ki database. No secrets live in this script.
set -euo pipefail

DB="dcsm_ki"
OUT_DIR="${1:-$(cd "$(dirname "$0")/.." && pwd)/backups}"
STAMP="$(date -u +%Y-%m-%d)"
OUT="$OUT_DIR/${DB}-${STAMP}.sql"
KEEP=12

mkdir -p "$OUT_DIR"

echo "→ exporting $DB (remote) to $OUT"
npx wrangler d1 export "$DB" --remote --output "$OUT"

bytes=$(wc -c < "$OUT" | tr -d ' ')
if [ "$bytes" -lt 2000 ]; then
  echo "!! export looks too small ($bytes bytes) — not pruning, check it by hand" >&2
  exit 1
fi
echo "✓ wrote $bytes bytes"

# prune: keep the newest $KEEP, drop the rest
mapfile -t old < <(ls -1t "$OUT_DIR"/${DB}-*.sql 2>/dev/null | tail -n +$((KEEP + 1)))
for f in "${old[@]:-}"; do
  [ -n "$f" ] || continue
  echo "  pruning $(basename "$f")"
  rm -f "$f"
done

echo "done. $(ls -1 "$OUT_DIR"/${DB}-*.sql | wc -l | tr -d ' ') backup(s) on disk."
