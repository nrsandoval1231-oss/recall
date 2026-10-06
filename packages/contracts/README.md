# Versioned contracts

The JSON Schemas here are draft V1 capture and extraction envelopes. They are design artifacts that can be validated now; they do not mean an API or model pipeline exists.

Use JSON Schema draft 2020-12. Structural validation must be supplemented by authorization, hash, referential, quote, version, date, and uncertainty checks described in `docs/API-CONTRACT.md` and `docs/AI-INGESTION.md`.

The synthetic examples under `tests/fixtures/synthetic` contain no image bytes and no real client data. Validate them against these schemas; do not report them as handwriting tests.

Keep one authoring source per contract. Runtime implementation must consume/generate these envelopes rather than independently inventing incompatible copies. API resource endpoints will have generated OpenAPI/client types once implemented. A schema change must update examples and regression tests in the same packet.
