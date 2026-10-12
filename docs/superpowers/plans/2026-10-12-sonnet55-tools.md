# Sonnet 5.5 native librarian compatibility

Problem: an owner-run live request returned HTTP400 because Sonnet5.5 rejects forced `tool`/`any` selection. A separate synthetic probe succeeded using automatic selection. The original saved source and uncertain reservation must survive.

1. Reproduce the native parser's rejection of valid surrounding content with a failing test.
2. Send automatic tool selection; require one complete closed native tool result and discard only bounded known nonpublishing blocks.
3. Surface numeric HTTP statuses without provider error bodies; retain conservative spending and resend guards.
4. Independently review and verify all exact-head CI jobs before normal squash merge.
5. Handle explicit reviewed recovery in a separate slice; never delete the old ledger or automatically resend the original.

Validation: source-identical native core196 tests, independently reproduced. Live probe verifies auto compatibility only, not the complete source pipeline. Installed corrected Windows build and full publication/restart acceptance remain open.
