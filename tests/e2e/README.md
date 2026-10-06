# End-to-end

`rcl001.e2e.ts` drives the real sync engine and API client against a real server; it is launched by `services/backend/tests/test_e2e_clients.py` (uvicorn + temp PostgreSQL). It proves local = server = cloud-on-disk = desktop-fetched SHA-256 through an interrupted upload and relaunch, plus cross-user isolation. Synthetic images only. Real-device acceptance is documented in `docs/DEVELOPMENT.md` and recorded in `docs/ACCEPTANCE.md`.
