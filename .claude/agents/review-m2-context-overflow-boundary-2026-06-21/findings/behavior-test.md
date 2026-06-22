# behavior + test-auditor — m2-context-overflow-boundary
Verdict: 0 BLOCKER, 0 HIGH (1 LOW → addressed). 8/8 green (+ error-packaging gate green).
- INFO: fix correct — canonical metadata.code wins over prefixed top-level .code; top-level fallback intact; neither→no code; non-string metadata.code falls back; set-once + message unchanged. Provider-agnostic (anthropic + openai-compatible).
- INFO: contract tests feed the REAL mappers with the correct body shape per mapper (anthropic=message-text, openai=structured error.code) → non-vacuous (pre-fix .code-only would fail).
- INFO: no regression (error-packaging gate green; loop.ts budget-gate producer unaffected). Optional chaining keeps it non-throwing for null/string cause.
- LOW → FIXED: added a non-object-cause (null/string) test.
