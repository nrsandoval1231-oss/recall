# Recall current state

Owner request: implement secure owner-approved no-sign-in device connection and one synthetic Claude photo evaluation batch capped at USD 5. Publish a separate stacked draft PR; no merge, deployment, real enrollment, private uploads or installation authorized.

Repository: nrsandoval1231-oss/recall. Base: PR13 `a17c2402ee5778a4015c50934bb91c7a59359dfe`. Working branch: `implement/owner-device-pairing`. PR9/11/12/13 match supplied heads. PR10 only adds `packages/sync/src/sniff.test.ts`; preserve separately.

Canonical references: `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/V1-STATUS.md`, `AGENTS.md`, Claude reading design and implementation README. Owner's current explicit pairing authorization supersedes older pairing exclusion; production boundaries remain.

Graph: `WORK_GRAPH.md`. EVAL-01, PAIR-01 and NATIVE-PAIR-REPAIR have terminal handoffs. EVAL's10 offline tests pass/live skip. Pairing/preflight/backup/UI focused checks pass; native failure/race tests are authored and formatting passes, but Cargo execution is CI-required. Source and explanatory documentation freeze together. Next: full deterministic gates and independent Sol review, then stacked draft PR and exact-head CI. Delivery acceptance is recorded in the draft PR and local ignored `.agent/ACCEPTANCE.local` when available; absent evidence remains UNKNOWN.

Owner configured root ignored .env but explicitly says its API key is OpenAI. Presence and Git ignore checked without displaying value; incompatible with Claude. Do not send it to Anthropic. Live quality/usage UNKNOWN; no dispatch or charge occurred. Synthetic USD5 approval does not authorize production activation or recurring usage.

Windows/native/phone/live service/cross-device acceptance remain distinct. No claim of product completion.
