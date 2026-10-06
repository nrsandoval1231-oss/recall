# Shared client sync protocol

Reserved for transport-independent pending-operation states, replay/idempotency behavior, cursor handling, and conflict response types. No sync implementation exists yet.

Use app-specific SQLite/filesystem adapters. Server authorization, commit ordering, and domain mutation rules stay in the backend. Do not create a general sync framework or a second canonical state store.

Implement when RCL-004 needs it; mobile durable drafts in RCL-001 can remain a small native adapter rather than prebuilding full offline replication.
