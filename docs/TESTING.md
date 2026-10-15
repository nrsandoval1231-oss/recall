# Testing Recall: guide for friends

Thanks for trying Recall. It's an early build. Things will break, and that's exactly what we want to find out.

**What it is:** a private memory app for Windows. Photograph handwritten notes or type a brain-dump. Recall saves the original, organizes it, and later you can ask a vague question ("what was that thing about the utility delay?") and get the answer with the original page as proof. Everything stays in a folder on your computer.

## 1. Install (5 minutes)

1. Download the `.exe` from the [latest pre-release](https://github.com/nrsandoval1231-oss/recall/releases).
2. Run it. Windows will warn **"Windows protected your PC"** because the app isn't code-signed yet. Click **More info → Run anyway**.
3. Open Recall → **Settings** (gear icon) → **Create library**. Pick an empty folder, or use the default `Documents\Recall`.

Recall works without any AI setup: you can capture, edit and keyword-search right away.

## 2. Turn on AI organizing (optional, costs a little money)

Recall uses **your own** API keys, billed to you. Budgets cap the spend.

**Claude** (photo reading and organizing):
1. Create an account at [console.anthropic.com](https://console.anthropic.com), add a few dollars of credit, and create an API key.
2. In Recall: **Settings → AI providers → Claude**. Paste the key. The model (`claude-sonnet-5-5`), prices and budgets are prefilled; lower the budgets if you like (Recall refuses calls past them).
3. Click **Save Claude**.

**Jev** (structured parsing): whoever invited you will send Jev access details (key and price). Paste them into the **Jev** section and click **Save Jev**. Until then Recall still saves and searches everything, but captures stay "pending" instead of being organized.

Keys are stored in Windows Credential Manager and never shown again in the app.

## 3. What to try (about 20 minutes)

Please use **made-up or non-sensitive notes**. This is a test build.

1. **Write**: paste a messy, half-finished meeting note. Save it.
2. **Camera**: photograph a page of your own handwriting and save it.
3. If AI is on: let it organize both. Did it get names, dates and to-dos right? Did it leave unsure things marked as unsure?
4. **Edit** one note. Close and reopen Recall. Still there?
5. **Ask** a vague question about something you captured, phrased differently from your note. Did it find it? Does the answer show the original?
6. **Correct** something it got wrong.
7. Open **Graph View** and click around.

## 4. Send feedback

Text or email whoever invited you, or [open a GitHub issue](https://github.com/nrsandoval1231-oss/recall/issues) if you have an account. Most useful:

- What you tried, what you expected, what happened, plus a screenshot.
- Anything confusing, even if it "worked".
- Would you actually use this? What would make you?

**Don't send real private notes or your API key in feedback.**

## Known limitations

- Windows only. Unsigned installer.
- **Speak** (voice) isn't built yet.
- Ask returns quoted passages from your notes, not a written answer.
- The phone companion needs extra setup (Tailscale); skip it for now.
