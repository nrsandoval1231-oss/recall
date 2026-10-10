# Recall desktop

The product path is the Memory Surface. It opens without an email, password, or sign-in link and keeps memory in a local Obsidian vault. Run it from [docs/DEVELOPMENT.md](../../docs/DEVELOPMENT.md).

`npm run dev` is a browser preview of that surface. It shows the synthetic Brooks Campus fixture and cannot write files. `npx tauri dev` chooses a vault folder, or creates `Documents/Recall`, then imports a photo into `Recall/Sources` and a Markdown note into `Recall/Memories`.

Ask searches note text and opens the original. It is keyword search, not a Claude answer. Claude reading is off unless a test injects the synthetic reader, and that reader does not make a network call.

`?mode=legacy-cloud` keeps the older cloud desktop, including its email sign-in. It is not the happy path. The Windows NSIS build is unsigned. An Actions artifact is not an installed-app acceptance.
