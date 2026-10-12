# Native meeting publication

Publish only validated persisted Jev + closed Claude organization records. Native rendering and source/context revision checks occur under the existing writer lock. Reuse journal/receipt/history/backups/recovery; no parallel file writer. Introduce a fenced v3 note representation so native Obsidian YAML starts at byte zero while v1/v2 history remains byte-compatible. v3 human corrections, external edits, rename, restore and removal preserve complete documents and stable identity. Older apps refuse the v3 manifest.

Regression requirements: initial publication, restart/idempotent receipt, source/context mismatch, human/external edits before commit, existing preservation/failure boundaries, YAML identity and rename, and a source-backed vague utility-delay query. Original text remains immutable; uncertain estimates, dates and retractions retain source labels. No live inference claim without providers.
