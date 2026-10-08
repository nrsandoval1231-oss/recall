#!/bin/sh
set -eu
MIGRATION_PASSWORD="$(cat /run/secrets/migration_password)"
API_PASSWORD="$(cat /run/secrets/api_password)"
export MIGRATION_PASSWORD API_PASSWORD
psql -X --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --file=/ops/initialize-roles.sql >/dev/null
unset MIGRATION_PASSWORD API_PASSWORD
