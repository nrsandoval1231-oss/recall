# Supabase platform setup

Proposed default, not a provisioned project.

This boundary owns Auth configuration, private Storage buckets/policies, platform roles/settings, and verified backup/export behavior. Application table migrations have one owner: `services/backend/migrations`.

Disable unused exposed database APIs or secure every exposed table with least-privilege/RLS. Never ship a service-role key to clients. Private originals require authorized serving and short-lived source URLs where used.

Database backups alone do not preserve Storage object bytes. Test both parts of recovery before the pilot. Capture actual settings and provider plan evidence at deployment; do not assume security from default configuration.
