#!/usr/bin/env sh
# LifeVault restore (production Docker stack). DESTRUCTIVE: replaces the current data.
#
#   ./scripts/restore.sh backups/lifevault-db-<stamp>.dump backups/lifevault-documents-<stamp>.tar.gz
#
# The .env must contain the SAME VAULT_MASTER_KEY that was used when the backup was made,
# otherwise vault entries can't be decrypted.
set -eu

DUMP="${1:?path to lifevault-db-*.dump}"
DOCS="${2:?path to lifevault-documents-*.tar.gz}"
COMPOSE="docker compose -f docker-compose.prod.yml"

printf "This replaces ALL current LifeVault data. Type RESTORE to continue: "
read -r answer
[ "$answer" = "RESTORE" ] || { echo "Cancelled."; exit 1; }

echo "Stopping the app..."
$COMPOSE stop backend web

echo "Restoring database..."
$COMPOSE exec -T db sh -c 'pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$DUMP"

echo "Restoring documents..."
$COMPOSE run --rm --no-deps -T --entrypoint sh backend -c 'rm -rf /app/var/documents/* && tar -C /app/var -xzf -' < "$DOCS"

echo "Applying any newer migrations and starting..."
$COMPOSE up -d
echo "Restore complete."
