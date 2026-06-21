# test-auditor — m3-repo-map
Verdict (initial): 0 BLOCKER, 2 HIGH, 2 MEDIUM, LOW. 13/13 green.
- HIGH → FIXED: EC-1 symlink test non-distinguishing (maxDepth alone bounded it; a symlink-follower would also pass). Now asserts structural invariant: loop listed as leaf (no "loop/"), real appears exactly once.
- HIGH → FIXED: EC-1 test vacuous on no-symlink platforms (silent `return` → reports PASSED). Now `it.skipIf(!SYMLINKS_OK)` with a capability probe → reports SKIPPED.
- MEDIUM → FIXED: file-as-cwd branch untested → added test.
- MEDIUM → FIXED: per-dir cap "(N more)" untested → added test (250 entries → "(50 more)").
- LOW: EC-3 empty-dir not asserted (accepted-risk per edge report).
- INFO: budget/maxDepth tests strong (assert absent+present); never-throw proven; deterministic.
