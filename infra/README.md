# Infrastructure boundary

No cloud resources or paid services have been provisioned.

Proposed pilot: managed Supabase Postgres/Auth/private Storage plus one API deployment and one durable worker process from the same backend package. Choose a compatible host when the owner authorizes deployment. Do not add a service mesh, Redis, a graph database, or another vector service by default.

Application schema migrations live under `services/backend/migrations`. This directory will own repeatable deployment configuration, secrets references (not values), backup/object-preservation configuration, and operational checks.

Provider plans, regions, pricing, retention, signing, and spend limits are deployment gates. The development database may be local; the deployed canonical database must not depend on Paul's PC.
