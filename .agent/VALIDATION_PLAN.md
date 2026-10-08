# Frozen candidate validation

After both terminal builder handoffs, freeze implementation and explanatory documentation. Controller validates full backend Ruff lint/format, mypy and pytest with PostgreSQL18; root npm lint/typecheck/unit tests; web/desktop production builds; web and local-vault browser suites; affected native Rust formatting with verified portable rustfmt. GitHub exact-head CI must additionally pass backend container import, Linux and Windows cargo test/check, browser/mobile bundle, and unsigned Windows installer build. Local Rust compiler is unavailable; local formatting alone does not prove native behavior.

Independent reviewer must inspect the exact integrated committed candidate, actual diff, canonical alignment, pairing/budget/receipt boundaries and deterministic evidence. Fix material findings, re-freeze and rerun affected checks. No grade by builders or certification by the architect. Review evidence cannot be silently extended to changed implementation/docs.

Publish separate draft PR above implement/claude-vault-reading, without force-push. Bind final CI and downloaded installer to final head; record artifact SHA256 and unsigned status. No merge, deployment, installation, real pairing or production access.

Live Claude gate: blocked on compatible owner-authorized Anthropic AI_API_KEY. OpenAI key stays unused. No live quality or spend inferred from offline tests. Font-rendered smoke fixtures cannot establish human handwriting quality. If live remains blocked, deliver code/harness/installer with explicit open live and installed-device/phone/cross-device gates and runnable instructions.
