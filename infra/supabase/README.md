# Supabase platform setup

Nothing here is provisioned by this repository; creating the project is an owner-authorized, possibly paid action. Application tables have exactly one owner: `services/backend/migrations`.

Required for live acceptance (gate G2):

1. **Auth**: email provider with one-time codes; **disable public signups** (invite/pre-create test users). Note the issuer (`https://<ref>.supabase.co/auth/v1`) and JWKS URL (`/.well-known/jwks.json`) for `RECALL_AUTH_ISSUER` / `RECALL_AUTH_JWKS_URL`. Prefer asymmetric signing keys over the legacy HS256 secret.
2. **Storage**: one **private** bucket (default `recall-originals-private`); no public access and no storage policies granting clients direct access — only the API's service-role key touches it.
3. **Database**: create an owner role for migrations and a separate non-owner API login role (`nosuperuser nobypassrls`), run `python -m recall.db.migrate` as the owner, then `grant recall_app to <api role>` and, for the RCL-002 worker, a third login role with `grant recall_worker to <worker role>`. Do not point the API at the `postgres`/service role. Disable the exposed Data API (PostgREST) for these tables or leave them unexposed; they have RLS but are not designed for direct client access.
4. **AI provider (RCL-002)**: the provider key, prices, and budgets live only in the API/worker secret store. Review the provider's retention/training terms for the account before turning AI reading on for real data.
5. **Secrets**: `SUPABASE_SERVICE_ROLE_KEY` and database URLs live only in the API's secret store. Clients get the URL and the *publishable* key.
6. Capture plan/backup/retention evidence at provisioning; Storage bytes are not covered by database backups.
