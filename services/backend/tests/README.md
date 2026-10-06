# Backend tests

No runtime tests exist yet. Add unit and integration coverage with the first executable packet.

Start with capture manifest/content validation, idempotency replay/conflicts, original hash verification, upload finalization, and cross-workspace source access. Use real local Postgres and controlled private-object test storage for integration behavior; mocks do not establish RLS/storage correctness.

Later cover worker leases, uncertainty/identity policy, user-correction precedence, retrieval evidence, sync ordering, deletion, and export snapshots. Refer to `docs/ACCEPTANCE.md` for release scenarios.
