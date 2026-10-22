# Native desktop boundary

## Current continuation — automatic organization

REALIGN-01 and TEXT-01 have independent local acceptance in `.agent/REALIGN-01/COMPLETION.json` and `.agent/FINISH-02/TEXT-COMPLETION.json`. INTELLIGENCE-01 has independent bounded acceptance for grounded Ask over current vault evidence in `.agent/INTELLIGENCE-01/COMPLETION.json`. ORGANIZE-01 is the active candidate: after one remembered purpose-specific opt-in, future text and photo captures are automatically queued for useful Obsidian organization. Its current status is in the active `.agent/ORGANIZE-01.md` packet; implementation in progress is not acceptance. Ask uses a separate, default-disabled `vault_intelligence` permission and versioned excerpt-processing consent. Photo permission does not authorize Ask. No live activation or provider processing is implied.

Ask considers up to eight current eligible memories, with bounded excerpts and visible coverage limits. It preserves uncertainty, opens cited memories/originals, and suppresses answers after source or vault changes. Keyword search remains available locally; it is not an offline generated answer. Historical questions, automatic AI text organization, grounded cross-memory links, voice/files, phone transport and full real-device/live acceptance remain open.

`local_vault.rs` owns native folder/photo selection, immutable source bytes, versioned history, journaled writes, hash checks, lifecycle recovery and conflict-safe Obsidian reconciliation. Local selected-vault commands require the ephemeral `expectedVaultId`; stable vault identity scopes display/pending intent only. The renderer never supplies filesystem paths.

## Vault note formats

TEXT-01 adds fenced v5 for typed/pasted notes: immutable exact UTF-8 `.txt` originals, an original-text link and an editable human body. V5 photo notes reuse v4 rendering. Older v1-v4 events retain their renderer and stored history bytes, and the prior manifest is retained before upgrade. Text originals are verified as bounded UTF-8 and served as text; the photo-reading boundary rejects them before network dispatch. No AI text interpretation is implied. See `.agent/FINISH-02/TEXT-COMPLETION.json` for the exact candidate's validation and review.

Legacy v1-v3 notes keep their original renderer when read or reconciled. A new successful photo reading, or another qualifying write, advances the manifest to fenced v4 and preserves the exact prior manifest bytes. Older writers must refuse v4. Existing notes are not bulk migrated.

The v4 note starts with flat YAML properties `id`, `status: "saved"`, `captured`, `source`, and `review`. `review` is `"not_read"`, `"unreviewed"` or `"corrected"`. The quoted `source` property is a vault-root link of the form `[[Recall/Sources/<uuid>.<ext>]]`; the note body uses a relative Markdown link to the original. The organized body contains a summary, source transcription and provenance, source-local mentions, source-backed statements, suggested actions, uncertainties, then a human annotation region. Model-derived sections remain proposals.

Direct edits are supported only in the trailing human annotation region while the generated prefix and evidence link remain intact. Editing generated properties, reading, statements, provenance or the original link conflicts; Recall never silently replaces those edits. The dedicated transcription-correction command creates a journaled revision and suppresses stale machine reading/organization from the current note/search while retaining prior versions in history. See [v4 candidate compatibility and acceptance](../../../docs/DATA-MODEL.md#native-markdown-renderer-v4--candidate-contract).

Lifecycle support includes flat stable-ID renames, explicit missing-note restore, retained logical-removal tombstones and validated keyword-projection rebuild. Removal retains files/history and is not secure purge or undelete. See [local lifecycle evidence](../../../docs/implementation/local-vault-lifecycle/README.md) and [bounded photo-reading evidence](../../../docs/implementation/claude-vault-reading/README.md). The recorded development checkpoint includes 173 native tests passed on the implementation candidate; exact validation/review is recorded in `.agent/REALIGN-01/COMPLETION.json` when frozen. This is not installed Windows, live-provider or full product acceptance.

The separate legacy native cache boundary owns app-private SQLite, source inventory, outbox/cursor state and managed export writes. Those cloud contracts remain preserved; they do not make local vault notes database-authoritative.

Tauri capabilities (`capabilities/default.json`) grant only `core:default`; dialogs/filesystem access occur inside narrow Rust commands. Never add unrestricted shell or filesystem access. Rust 1.89+ is required for filesystem locks.
