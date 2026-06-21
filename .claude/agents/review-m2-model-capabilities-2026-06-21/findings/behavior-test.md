# behavior + test-auditor — m2-model-capabilities
Verdict: 0 BLOCKER, 0 HIGH (2 LOW, INFO). 18/18 green.
- INFO: bug fix correct + strip order right (suffix before inferVendorPrefix → EC-1 works). Traced gpt-4o:free→128k, vertex/claude:nitro→200k; no-suffix + unknown unchanged. Truncation provably safe (all 12 EXACT keys colon-free). Edge ""/":" → defaults, no throw. Resolver pure/sync/offline (zero imports). @public JSDoc accurate.
- INFO: 6 suffix tests non-vacuous (exact 128_000/>4096/4096); EC-1 covered; 9 pre-existing pass; wiring test asserts import+determinism+export.
- LOW: colon-free invariant only JSDoc-guarded (optional: add a keys-iteration test — skipped, EXACT is internal, behavior coverage adequate). LOW: pre-fix failure-mode not directly asserted (covered incidentally by test_bare_suffix).
