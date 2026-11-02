# MONOLITH mobile client (Expo / React Native)

This Expo client is an implementation candidate for phone capture and recall. Product requirements and release gates are in [PRD](../../docs/PRD.md) and [STATUS](../../docs/STATUS.md); physical iPhone behavior has not been accepted.

Durability logic (copy into app-private storage, hash, manifest, single atomic commit, startup recovery, resumable idempotent upload) is in `packages/sync` and tested; `src/platform/*` are thin Expo adapters (`expo-file-system`, `expo-secure-store`, `expo-crypto`). Native behaviour is **not yet verified on a device** (ACCEPTANCE gate G3). Captures are bound to the signed-in account and are never uploaded under another.

Setup/run: [DEVELOPMENT](../../docs/DEVELOPMENT.md). Placeholder icons from the Expo template are not a brand.

Current implemented screens include capture, Ask, source detail and settings. These describe code presence only; synthetic tests and a bundle build do not establish installed-device or release acceptance.

