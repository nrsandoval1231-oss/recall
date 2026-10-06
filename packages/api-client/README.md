# Shared API client (`@recall/api-client`)

Thin typed client for the RCL-001 routes (types mirror `docs/API-CONTRACT.md` and are exercised against a live server by `tests/e2e`; they are hand-written, not generated, because the API returns plain JSON), stable `ApiError`/`NetworkError`, auth wrapper over Supabase Auth (email code; publishable key only), SHA-256 helper, and chunked secret storage for OS credential stores. No privileged keys, no business rules.
