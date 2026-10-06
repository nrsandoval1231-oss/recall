# Recall backend

Planned FastAPI API and durable worker from one Python package. No server or worker runs yet.

Initialize only the modules and dependencies needed by the active packet. API handles authenticated transport; domain owns deterministic policy; ingestion proposes/validates derived memory; retrieval assembles authorized evidence; sync handles feed/commands; exports handles portable snapshots; db handles persistence.

The application migration history belongs here. Supabase platform setup must not duplicate it. Use a least-privilege request role and explicit tenant context; do not assume a privileged connection is protected by RLS.

RCL-001 ends at verified original storage. RCL-002 introduces the durable worker and AI. No in-request fire-and-forget processing, provider secrets in clients, or local-PC dependency for cloud capture.
