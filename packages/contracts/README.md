# Versioned contracts

The JSON Schemas here version capture and extraction envelopes shared by the preserved cloud pipeline and selected-photo reading path. They define payload shape; backend validators and domain code add authorization, source binding, provenance and semantic checks. A schema passing does not establish model quality or live-provider acceptance.

Use JSON Schema draft 2020-12. Structural validation must be supplemented by authorization, hash, referential, quote, version, date, and uncertainty checks described in `docs/API-CONTRACT.md` and `docs/AI-INGESTION.md`.

The synthetic examples under `tests/fixtures/synthetic` contain no image bytes and no real client data. Validate them against these schemas; do not report them as handwriting tests.

Keep one authoring source per contract and update consuming validators, examples and regression tests together. The API currently returns plain JSON and the TypeScript API client is hand-written; generated OpenAPI/client types are not present. This package does not prove that every API response is schema-generated.
