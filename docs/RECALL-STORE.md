# Recall store

The desktop product and the phone companion keep memory in a folder Recall owns. The [2026-10-11 amendment](PILOT-CONTRACT.md) is the authority for this. Markdown is the note format. Obsidian is not part of the product path, and a Claude API key is not required to capture, review, or ask.

```text
<vault>/Recall/Sources/   original photo bytes, written once
<vault>/Recall/Memories/  Markdown notes
<vault>/Recall/History/   append-only revisions
<vault>/Recall/_meta/     manifest, journal, commit receipts, preserved local edits
```

The default folder is `Documents/Recall`. A person can choose another folder. The webview cannot pass a path.

Review happens in Recall's Memories browser, grouped by the month of capture. Ask searches these notes on the device and cites the note it used. A file changed outside Recall is kept; the next save does not overwrite it silently.

Cloud Postgres, private object storage, and SQLite remain the store for the optional web companion and the legacy cloud desktop (`?mode=legacy-cloud`). They are not the memory authority for this vault.
