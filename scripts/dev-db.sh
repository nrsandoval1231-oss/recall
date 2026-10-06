#!/usr/bin/env bash
# Repeatable LOCAL development database (Docker + PostgreSQL 16). Not for production.
#   scripts/dev-db.sh up      create/start the container, create roles, run migrations, print env
#   scripts/dev-db.sh down    stop and remove the container and its volume
# Passwords are random per machine and written only to the git-ignored .env.local-dev.
set -euo pipefail
cd "$(dirname "$0")/.."
NAME=recall-dev-pg
PORT="${RECALL_DEV_PG_PORT:-54329}"
ENV_FILE=.env.local-dev

case "${1:-up}" in
  down) docker rm -f -v "$NAME" >/dev/null 2>&1 || true; rm -f "$ENV_FILE"; echo "removed $NAME"; exit 0 ;;
  up) ;;
  *) echo "usage: $0 up|down" >&2; exit 2 ;;
esac

if [ ! -f "$ENV_FILE" ]; then
  {
    echo "PG_SUPER_PASSWORD=$(openssl rand -hex 16)"
    echo "PG_OWNER_PASSWORD=$(openssl rand -hex 16)"
    echo "PG_API_PASSWORD=$(openssl rand -hex 16)"
    echo "RECALL_SIGNING_SECRET=$(openssl rand -hex 32)"
  } > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

if ! docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  docker run -d --name "$NAME" -e POSTGRES_PASSWORD="$PG_SUPER_PASSWORD" -p "127.0.0.1:$PORT:5432" postgres:16 >/dev/null
fi
docker start "$NAME" >/dev/null
until docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1; do sleep 0.5; done

psql_su() { docker exec -i "$NAME" psql -v ON_ERROR_STOP=1 -U postgres "$@"; }
psql_su -d postgres <<SQL
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname='recall_owner') then
    create role recall_owner login createrole password '$PG_OWNER_PASSWORD';
  end if;
  if not exists (select 1 from pg_roles where rolname='recall_api') then
    create role recall_api login nosuperuser nobypassrls password '$PG_API_PASSWORD';
  end if;
end \$\$;
SQL
docker exec "$NAME" psql -U postgres -tc "select 1 from pg_database where datname='recall'" | grep -q 1 \
  || psql_su -d postgres -c "create database recall owner recall_owner"
psql_su -d recall -c "grant all on schema public to recall_owner"

export RECALL_MIGRATION_DATABASE_URL="postgresql://recall_owner:$PG_OWNER_PASSWORD@127.0.0.1:$PORT/recall"
(cd services/backend && uv run python -m recall.db.migrate)
psql_su -d recall -c "grant recall_app to recall_api"

cat <<MSG

Local database ready. For the backend, in services/backend:

  export DATABASE_URL=postgresql://recall_api:$PG_API_PASSWORD@127.0.0.1:$PORT/recall
  export RECALL_MIGRATION_DATABASE_URL=$RECALL_MIGRATION_DATABASE_URL
  export RECALL_SIGNING_SECRET=$RECALL_SIGNING_SECRET
  # plus RECALL_AUTH_ISSUER and RECALL_AUTH_JWKS_URL (or RECALL_AUTH_JWT_SECRET) from your Supabase project

(values also saved in $ENV_FILE, which is git-ignored)
MSG
