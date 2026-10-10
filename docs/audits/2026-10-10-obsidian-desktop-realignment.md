# Audit: Obsidian-first, desktop-first realignment

Date: 2026-10-10. Audience: Nick Sandoval.

Authority: the [2026-10-10 amendment](../PILOT-CONTRACT.md) in `docs/PILOT-CONTRACT.md`, plus the owner-supplied visual reference [memory-surface-reference-2026-10-10.jpg](../assets/memory-surface-reference-2026-10-10.jpg). That image is credited as an owner-supplied reference dated 2026-10-10. Recall did not invent it.

Base at audit time: `main` `5bba325` (merge of PR #16). This audit does not deploy, merge, rebase, or close any pull request. It does not call a model or enroll a device.

The earlier same-day audit [2026-10-10-pr-stack-9-14.md](2026-10-10-pr-stack-9-14.md) judged PRs #9–#14 against the 2026-10-09 PWA contract and recommended holding or rewriting the vault stack. That recommendation is historical. Nick’s clarification supersedes it.

## Why PR #16 is not the “start using it” product

PR #16 is merged. It did the job the 2026-10-09 contract asked for: an installable `apps/web` PWA, no login screen, and operator device enrollment with synthetic negative tests. The [real-device deploy checklist](2026-10-10-real-device-deploy-checklist.md) is still unchecked. iPhone Home Screen, a Windows browser, and a deployed enrollment have not been accepted.

Deploying that app would still be the wrong launch. Nick’s product is: capture and ask in a polished desktop surface, let Claude organize, and keep the result as useful notes in Obsidian, with the original pages preserved. The phone is a companion for capture and ask, without Obsidian mobile and without an account. The web app can later carry enrollment or a light companion session. It is not the memory, and it is not the primary shell.

The 2026-10-09 contract also said no visual reference was attached. That sentence is false as of today. The desktop target is the checked-in image: glass panels over a physical notebook, Ask Recall, a project board, people, locations, topics, related context, a timeline, and recent memory thumbnails.

So: keep PR #16. Do not delete it, and do not describe it as unfinished fiction. Do not deploy it as the way to start using Recall. Do not run its checklist as the launch gate.

## Revive and rebase #11–#14; do not close them

These drafts are the Tauri/Obsidian vault stack. They are still open. They should be revived and rebased onto current `main` under the 2026-10-10 amendment. They should not be closed, and they should not be merged unchanged. They were stacked on the closed docs PR #9 and conflict with the October 9 reconciliations. A rebase has to keep their vault behavior and resolve those docs in favor of this amendment.

| PR | What it already is | Recommendation |
| --- | --- | --- |
| [#11](https://github.com/nrsandoval1231-oss/recall/pull/11) | Desktop opens a local Obsidian vault with no account, password, or email link. Photo import, original bytes, corrections. | Rebase. This is the foundation of the next slice. |
| [#12](https://github.com/nrsandoval1231-oss/recall/pull/12) | Rename, missing-note, and removal behavior that keeps originals and history, and refuses to clobber a local edit. | Rebase with #11. Required before vault writes are safe. |
| [#13](https://github.com/nrsandoval1231-oss/recall/pull/13) | Consented Claude reading of a selected photo into vault history, with uncertainty kept uncertain and corrections separate. | Rebase with #11–#12. This is the librarian path. |
| [#14](https://github.com/nrsandoval1231-oss/recall/pull/14) | Operator invitation for a paired desktop, plus a separate inference database and unsigned installer. | Keep open and rebase with the stack so the branch is not abandoned. Do not activate the host, the second database, or a public pairing endpoint in the next slice. Pairing is how a phone companion reaches the vault later. |

PR #10 (image-signature tests) is already merged. PR #9 (Obsidian-as-spine docs) is closed. Its direction matches Nick again; the 2026-10-10 amendment is the document that records it. Reopening #9 is unnecessary if the rebase carries the code and this contract is the doc authority.

Prior green CI and unsigned NSIS artifacts on #11–#14 stay historical evidence. They are not installed-Windows acceptance and they are not a reason to merge the stack as it sits.

## Proposed next engineering slice

Desktop Memory Surface, matching the owner reference, writing into a local Obsidian vault:

- Photo capture of a handwritten page, original bytes preserved.
- Claude reads the page and writes useful organized notes (people, projects, places, topics) into that vault.
- Natural-language ask over those notes, with the original page still reachable.
- The desktop composition from the reference: left rail (Ask Recall, Home, Recent, People, Places, Projects, Equipment, Timeline, Capture), project glass board, floating People / Locations / Key Topics / Related, timeline strip, recent memory thumbnails, physical original visible under the glass.
- No account, password, or email login.

The phone companion and any use of PR #16 as enrollment transport come after that desktop loop works. Do not start this slice by deploying the web app.

Storage honesty for the slice: `main` still treats Cloud Postgres as the canonical store and writes Obsidian as a managed export. AGENTS.md, ARCHITECTURE, PRD, ROADMAP, and SYNC-AND-EXPORT now say that in the historical tense and point at this amendment. The slice that writes the vault has to change the code and replace that historical wording with the new invariant in the same change. This audit does not pretend that migration already happened.

## Left labeled historical

- The 2026-10-09 contract text, under the amendment in `docs/PILOT-CONTRACT.md`.
- Banners and status lines that used to call the PWA the current pilot.
- [2026-10-10-pr-stack-9-14.md](2026-10-10-pr-stack-9-14.md) and the [web deploy checklist](2026-10-10-real-device-deploy-checklist.md).
- October 6 email-login notes and the email-rate-limit incident. They are not instructions to bring email sign-in back.

## Evidence boundary

Read from current `main` and GitHub PR metadata on 2026-10-10. The reference JPEG was copied from the owner upload into `docs/assets/` and checked as a 1536×1024 baseline JPEG with no GPS EXIF. Not done: deployment, merge or rebase of #11–#14, installer runs, device enrollment, or a live Claude call.
