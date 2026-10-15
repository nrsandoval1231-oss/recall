# Recall — v1 Acceptance Checklist

This is the real-device test for the [definition of done](VISION.md#definition-of-done-v1). Copy this file into a new dated section in [STATUS.md](STATUS.md), or attach a filled-in copy to the PR, each time you run it.

**Rules**
- One exact commit per run. Install the CI Windows installer built from that commit. A dev build doesn't count.
- Use **synthetic or approved test content only.** No client notes.
- A step passes only if you saw it happen. Anything skipped is **NOT RUN**, never pass.
- When something fails: write what you did, what you expected, what happened, plus a screenshot. Stop that section and continue with the next one.
- Button labels below may differ slightly from the app. Note any mismatch.

## Run header

| Field | Value |
|---|---|
| Date / tester | |
| Commit SHA | |
| Installer (CI run ID + artifact) | |
| Windows version | |
| iPhone model / iOS | |
| Jev model / Claude model | |
| Budget caps set (daily / monthly) | |

## Test material (prepare before starting)

- **T1 (typed meeting dump):**
  > Brad: maybe 5–10 MW? Utility delay unclear. Call Sarah about schedule. Need gens by Dec?? Prism doing electrical? Site access north? Ask operator about gas. No firm start date. Crossed-out: 8 MW confirmed.
- **P1:** a photo of one handwritten page (synthetic: write it yourself) with one name, one date, one number with a question mark and one crossed-out line.
- **P2:** a second handwritten photo that mentions the same project as P1.
- An empty USB drive or folder for the backup, and a second Windows machine or a clean Windows user account for the restore.

---

## A. Install and library (no other software)

| # | Do | Expect | Result |
|---|---|---|---|
| A1 | Fresh install on a machine/user without Obsidian | App opens to the ivory Capture screen. No login. | ☐ Pass ☐ Fail |
| A2 | Create a new library in an empty folder | Folder now has `Recall/Sources`, `Memories`, `History`, `_meta` | ☐ Pass ☐ Fail |
| A3 | Look at the empty screen | No fake people, projects, counts or graph data | ☐ Pass ☐ Fail |
| A4 | Settings: enter Jev + Claude keys, prices, budgets | Saved; keys are never shown back in full | ☐ Pass ☐ Fail |

## B. Capture (original saved first)

| # | Do | Expect | Result |
|---|---|---|---|
| B1 | Turn off Wi-Fi. **Write** → paste T1 → Save | Shows *Saved* and interpretation *pending*. No crash, no fake "Ready". | ☐ Pass ☐ Fail |
| B2 | Check `Recall/Sources` in File Explorer | T1 original is there | ☐ Pass ☐ Fail |
| B3 | Close and reopen the app (still offline) | T1 is still there, still pending | ☐ Pass ☐ Fail |
| B4 | **Camera** → choose P1 → Save | Shows *Saved*; the original image file is in `Sources` | ☐ Pass ☐ Fail |
| B5 | **Speak** | Clearly says unavailable; no fake recording | ☐ Pass ☐ Fail |

## C. Organize (Jev + Claude, honest states)

| # | Do | Expect | Result |
|---|---|---|---|
| C1 | Wi-Fi on. Give consent and process T1 | Stages move through real states (Understanding → … → Ready or Needs review) | ☐ Pass ☐ Fail |
| C2 | Read the organized T1 note | "5–10 MW?" stays uncertain; "8 MW confirmed" shown as crossed out/retracted, **not** fact; "Dec??" not a firm date; "Sarah"/"Brad" not merged into a known identity | ☐ Pass ☐ Fail |
| C3 | Process P1 | Transcription is readable. The question-mark number stays uncertain. The crossed-out line isn't stated as fact. | ☐ Pass ☐ Fail |
| C4 | Score P1 transcription: words wrong ÷ total words | Record % → ______ | — |
| C5 | Check people/project tags on T1 and P1 | Record each wrong tag → ______ | ☐ Pass ☐ Fail |
| C6 | Set the daily budget to $0.01 and process P2 | Refused with a clear budget message; P2 original still saved | ☐ Pass ☐ Fail |
| C7 | Restore the budget, process P2 | Ready / Needs review | ☐ Pass ☐ Fail |

## D. Edit (in Recall and outside it)

| # | Do | Expect | Result |
|---|---|---|---|
| D1 | Edit T1's note in Recall, add a sentence | Autosaves; revision appears in history | ☐ Pass ☐ Fail |
| D2 | Restart the app | Edit is still there | ☐ Pass ☐ Fail |
| D3 | Open T1's `.md` in Notepad, change a line, save | Recall picks up the change, and it shows in history | ☐ Pass ☐ Fail |
| D4 | Edit the same note in Notepad **and** in Recall without refreshing | Conflict is shown; neither version is silently lost | ☐ Pass ☐ Fail |

## E. Ask (vague question)

| # | Do | Expect | Result |
|---|---|---|---|
| E1 | Ask: "What was going on with that utility delay?" | Finds T1; quotes the source text; shows the date | ☐ Pass ☐ Fail |
| E2 | Ask about something on P1 using different words than the note | Finds P1, or honestly says no match | ☐ Pass ☐ Fail |
| E3 | Ask about something never captured | Abstains, with no made-up answer | ☐ Pass ☐ Fail |
| E4 | Offline, ask E1 again | Still works and is labelled keyword search | ☐ Pass ☐ Fail |

## F. Inspect why

| # | Do | Expect | Result |
|---|---|---|---|
| F1 | From the E1 answer, open the supporting note and original | Exact original appears; quote matches it | ☐ Pass ☐ Fail |
| F2 | View T1 history | Shows capture, organization, your edits, in order | ☐ Pass ☐ Fail |
| F3 | Check that AI text and your text are visually distinct | Yes | ☐ Pass ☐ Fail |

## G. Correct

| # | Do | Expect | Result |
|---|---|---|---|
| G1 | Correct a wrong tag or fact on P1 | Saved as a correction; original unchanged | ☐ Pass ☐ Fail |
| G2 | Reprocess P1 | Your correction survives | ☐ Pass ☐ Fail |
| G3 | Check T1 and P2 | Correction didn't spill into unrelated notes | ☐ Pass ☐ Fail |

## H. Graph and timeline

| # | Do | Expect | Result |
|---|---|---|---|
| H1 | Open Graph View | Nodes match real notes; P1–P2 link (if any) is explainable with source | ☐ Pass ☐ Fail |
| H2 | Click a node → inspector → close | Returns to the same viewport | ☐ Pass ☐ Fail |
| H3 | Use the timeline filter | Graph and list narrow by date; reset restores | ☐ Pass ☐ Fail |
| H4 | Keyboard only: Tab through capture, Ask, graph list, Escape | Everything reachable; focus visible | ☐ Pass ☐ Fail |
| H5 | Window at 1536×1024, 1182×789, 900×700 | Nothing cut off; capture never hidden | ☐ Pass ☐ Fail |

## I. Phone (iPhone + Tailscale)

| # | Do | Expect | Result |
|---|---|---|---|
| I1 | Start `recall-phone` on the desktop; open `http://<tailscale-ip>:8787/` on the iPhone | Capture/Ask page loads, no login | ☐ Pass ☐ Fail |
| I2 | Capture a photo + a text note from the phone | Shows saved; both appear on the desktop | ☐ Pass ☐ Fail |
| I3 | Ask from the phone | Quoted result, labelled keyword search | ☐ Pass ☐ Fail |
| I4 | Stop the desktop and capture on the phone | Phone says **saved on this device**, not "received" | ☐ Pass ☐ Fail |
| I5 | Start the desktop again | Item arrives once; no duplicate | ☐ Pass ☐ Fail |
| I6 | Device **not** on the tailnet opens the same URL | Can't connect | ☐ Pass ☐ Fail |

## J. Backup and restore

| # | Do | Expect | Result |
|---|---|---|---|
| J1 | Export a full library backup to the USB drive or folder | Completes; reports file count and hash check | ☐ Pass ☐ Fail |
| J2 | On a clean machine/user: install, restore the backup into an empty folder | Restores successfully | ☐ Pass ☐ Fail |
| J3 | On the restored copy: open T1, P1, history, your correction; run E1 | Everything present and identical | ☐ Pass ☐ Fail |
| J4 | Try restoring into a non-empty library | Refused; nothing merged or overwritten | ☐ Pass ☐ Fail |

## Sign-off

| Section | Pass / Fail / Not run | Issues filed |
|---|---|---|
| A Install | | |
| B Capture | | |
| C Organize | | |
| D Edit | | |
| E Ask | | |
| F Inspect | | |
| G Correct | | |
| H Graph | | |
| I Phone | | |
| J Backup | | |

**v1 is accepted only when every row passes on one commit.** Each failure becomes a small fix PR, then rerun the affected section on the new commit.
