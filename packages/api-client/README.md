# Shared API client (`@recall/api-client`)

Thin hand-written TypeScript client for the preserved authenticated mobile/cloud API described in `docs/API-CONTRACT.md`. It includes capture, upload, source, retrieval, sync and export route types/helpers used by the client, stable `ApiError`/`NetworkError`, a Supabase Auth wrapper (publishable key only), SHA-256 and chunked OS credential storage. Types are not generated from OpenAPI. This package does not implement the local desktop vault or the current no-sign-in product target; it contains no privileged keys or business rules.
