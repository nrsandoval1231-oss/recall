#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=owner_password="$MEGRAPH_OWNER_PASSWORD" --set=api_password="$MEGRAPH_API_PASSWORD" --set=worker_password="$MEGRAPH_WORKER_PASSWORD" <<'SQL'
CREATE EXTENSION IF NOT EXISTS vector;
CREATE ROLE recall_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE recall_worker NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE recall_owner LOGIN CREATEROLE NOSUPERUSER NOBYPASSRLS PASSWORD :'owner_password';
CREATE ROLE recall_api LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD :'api_password';
CREATE ROLE recall_worker_login LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD :'worker_password';
GRANT recall_app TO recall_api;
GRANT recall_worker TO recall_worker_login;
GRANT ALL ON SCHEMA public TO recall_owner;
ALTER DATABASE recall OWNER TO recall_owner;
SQL
