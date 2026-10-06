# Recall mobile (Expo / React Native, iPhone first)

RCL-001 scope only: email-code sign-in, camera + photo import, 1–10 ordered pages (reorder/remove/retake), optional hint, **Save** (durable local copy first), honest status (**Saved on this device / Uploading / Uploaded / Failed — retry available**), recent captures, original viewer with cloud-hash verification. No title/folder/tags, no AI.

Durability logic (copy into app-private storage, hash, manifest, single atomic commit, startup recovery, resumable idempotent upload) is in `packages/sync` and tested; `src/platform/*` are thin Expo adapters (`expo-file-system`, `expo-secure-store`, `expo-crypto`). Native behaviour is **not yet verified on a device** (ACCEPTANCE gate G3). Captures are bound to the signed-in account and are never uploaded under another.

Setup/run: [docs/DEVELOPMENT.md](../../docs/DEVELOPMENT.md). Placeholder icons from the Expo template are not a brand.

**RCL-002 additions:** Home has the dominant "What are you trying to remember?" entry; Ask shows cited answers or an honest "couldn't find it / more than one match / answers are off" with matching sources, each opening the original. Capture detail shows the machine reading (labelled) beside the original, unclear items, and a retry for a failed reading. Settings holds the opt-in AI-reading switch with its explanation, and sign-out.
