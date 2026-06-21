# cross-validation — m3-rich-errors
Verdict (initial): 0 BLOCKER, 1 HIGH, 1 MEDIUM, LOW.
- HIGH → FIXED: `no_matches` was a DEAD hint — no tool emits error:"no_matches" (glob returns {ok:true,files:[]} on empty; only a stale comment in glob-files.ts:9 mentioned it). Removed the dead hint, added `invalid_url` (a real web-fetch code) instead, fixed the glob-files stale comment, + a "no dead hints" regression test.
- MEDIUM → FIXED: docs/changeset overclaimed no_matches → replaced with invalid_url across docs.md + changeset (+ CHANGELOG had no code list).
- LOW (addressed): invalid_url now has a hint.
- INFO: ADRs D1-D5 honored; Coverage Matrix 8/8; zero deps; changeset @theokit/sdk-tools:minor correct; no scope creep.
