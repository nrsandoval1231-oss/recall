# Evaluation harness boundary

This directory contains synthetic evaluation utilities and fixtures, including selected-photo diagnostic images and the RCL-003B retrieval metric script. They are deterministic development tools, not a handwriting benchmark, private-corpus evaluation, or live-provider acceptance result. The selected-photo harness can issue provider calls only when explicitly configured; inspect the packet and cost/authorization boundary before running it.

The live pilot corpus is private and external to this repository. Use 20 development pages and 10 held-out pages as the proposed starting set; freeze holdout before tuning. Include difficult writing and genuinely unanswerable cases.

Report exact source/config hashes, critical-field accuracy, identity precision, retrieval coverage, supported-answer rate, uncertainty handling, latency, and actual usage cost. Do not equate schema validation with handwriting accuracy. See `docs/ACCEPTANCE.md`.
