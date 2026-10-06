# Primary technical references

Checked 2026-10-06. These support technology capabilities and cautions, not a claim that Recall is implemented. Recheck version-specific behavior before installing dependencies or provisioning a service.

- [Expo Camera](https://docs.expo.dev/versions/latest/sdk/camera/) — native camera access and temporary image URIs; copy captures to durable app storage before acknowledging local Save.
- [Expo permissions](https://docs.expo.dev/guides/permissions/) — native build-time configuration and runtime permission handling.
- [Expo build setup](https://docs.expo.dev/build/setup/) — actual device build/distribution prerequisites; development tooling is not proof of production installation.
- [Tauri capabilities](https://v2.tauri.app/security/capabilities/) — explicit native command permissions and their limits.
- [Tauri filesystem plugin](https://v2.tauri.app/plugin/file-system/) — permissions and allowed path scopes are distinct; scope local export narrowly.
- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) — platform-specific development prerequisites.
- [PostgreSQL full-text operators](https://www.postgresql.org/docs/current/functions-textsearch.html) — native text-search primitives for a keyword baseline.
- [PostgreSQL SELECT / locking](https://www.postgresql.org/docs/current/sql-select.html) — row-locking and SKIP LOCKED behavior used by the proposed job-claim design.
- [pgvector upstream](https://github.com/pgvector/pgvector) — exact/approximate vector retrieval, hybrid-search patterns, and filter/recall considerations. Pin the actual supported extension version during implementation.
- [Supabase data security](https://supabase.com/docs/guides/database/secure-data) — least privilege, RLS, and why service-role/secret keys must stay server-side.
- [Supabase private source serving](https://supabase.com/docs/guides/storage/serving/downloads) — private access and signed URL behavior; already issued URLs may remain valid until expiry.
- [Supabase database backups](https://supabase.com/docs/guides/platform/backups) — database recovery and the separate need to preserve Storage file bytes.
- [Obsidian file storage](https://help.obsidian.md/Files+and+folders/How+Obsidian+stores+data) — Markdown-based local storage supporting a portable archive.

Provider/model privacy terms, actual pricing, signing/distribution choices, and supported versions are deployment gates. They are deliberately not invented in this foundation.
