# Application migrations

No migrations exist yet. Introduce an ordered tested migration history when RCL-001 initializes the actual backend.

Own application tables, constraints, indexes, and required database policy here. Use workspace-scoped foreign keys, unique retry invariants, and version checks. Test empty-database creation and upgrades before production use. Never silently run destructive migrations against live data.

Platform auth/storage provisioning belongs in `infra/supabase`, not a second application-schema history. Later packets add only their required schema.
