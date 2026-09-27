#!/usr/bin/env sh
# LifeVault backup: database dump + stored documents, for the production Docker stack.
#
#   ./scripts/backup.sh [backup-dir]        (default: ./backups)
#
# Produces:  <dir>/lifevault-db-<timestamp>.dump        (pg_dump custom format)
#            <dir>/lifevault-documents-<timestamp>.tar.gz
# The vault master key (VAULT_MASTER_KEY) is NOT included on purpose: store it separately.
# Backups contain personal data. Keep them encrypted and off this machine.
set -eu

COMPOSE="docker compose -f docker-compose.prod.yml"
DIR="${1:-./backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$DIR"
umask 077

echo "Dumping database..."
$COMPOSE exec -T db sh -c 'pg_dump --format=custom --no-owner -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$DIR/lifevault-db-$STAMP.dump"

echo "Archiving documents..."
$COMPOSE run --rm --no-deps -T --entrypoint sh backend -c 'tar -C /app/var -czf - documents' > "$DIR/lifevault-documents-$STAMP.tar.gz"

echo "Done:"
ls -l "$DIR"/lifevault-*-"$STAMP".*
