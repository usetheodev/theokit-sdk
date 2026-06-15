# Edge Case Review — theokit-sdk-claude-consumer-template

Date: 2026-06-12
Tasks analyzed: 19 (T1.1, T2.1-T2.4, T3.1-T3.15)
Edge cases found: 8 (MUST FIX: 3, SHOULD TEST: 3, DOCUMENT: 2)

## MUST FIX

### EC-1: `cpSync` not available in Node < 16.7, `recursive` option requires 16.7+
- **Affected task:** T1.1
- **Family:** Boundary
- **Scenario:** Consumer runs `npx theokit-init-claude` on Node 16.0-16.6. `cpSync` with `{recursive: true}` throws `TypeError`.
- **Impact:** Script crashes with unhelpful error.
- **Suggested fix:** Add `engines: { node: ">=22.12.0" }` check at script start matching the SDK's own `engines` field. Three lines: `const v = process.versions.node.split('.').map(Number); if (v[0] < 22) { console.error("Node >= 22.12.0 required"); process.exit(1); }`

### EC-2: AGENTS.md import map will be stale on next SDK release with new sub-paths
- **Affected task:** T2.1
- **Family:** State / Staleness
- **Scenario:** SDK adds a new sub-path export (e.g., `@theokit/sdk/voice`) in v1.8. The AGENTS.md still lists the v1.7 import map. Consumers using the new sub-path get no guidance.
- **Impact:** AGENTS.md becomes misleading — lists some sub-paths but not all.
- **Suggested fix:** Add a CI check (`scripts/check-claude-template-drift.ts`) that compares `package.json` exports keys against AGENTS.md import map section. Fails on mismatch. Add as a sub-step in T2.1's TDD.

### EC-3: All 15 skills use `paths: ["**/*.ts"]` — every skill loads on EVERY TypeScript edit
- **Affected task:** T3.1-T3.15
- **Family:** Resource / Token cost
- **Scenario:** Consumer edits any `.ts` file. Claude Code loads ALL 15 skills simultaneously (each ~200 lines = 3000 lines of context injected). This is 15x the cost of a single skill and may degrade Claude's response quality by diluting the context.
- **Impact:** Token waste + potential response quality degradation. Anthropic recommends <200 lines per CLAUDE.md; 15 skills at ~200 lines each would inject ~3000 lines.
- **Suggested fix:** Differentiate `paths:` per domain. Agent Core keeps `["**/*.ts"]` (most common). Memory skill uses `["**/memory/**", "**/*memory*"]`. DI uses `["**/di/**", "**/*container*", "**/*inject*"]`. Gateways uses `["**/gateway*/**", "**/slack*", "**/telegram*"]`. Each skill fires only on files that actually touch its domain. This is the critical fix — without it, the passive skill strategy backfires.

## SHOULD TEST

### EC-4: Consumer already has AGENTS.md or CLAUDE.md at project root
- **Affected task:** T1.1
- **Suggested test:** `test_init_claude_preserves_existing_agents_md()` — when AGENTS.md already exists at root, script should warn (not silently overwrite) even without `--force`. Current plan checks `.claude/` existence but not root-level AGENTS.md/CLAUDE.md independently.

### EC-5: `import.meta.dirname` undefined in older Node ESM
- **Affected task:** T1.1
- **Suggested test:** `test_init_claude_dirname_resolution()` — verify `import.meta.dirname` resolves correctly. On Node < 21.2, `import.meta.dirname` is `undefined`. The `fileURLToPath` fallback in the pseudo-code handles this, but the plan should test both paths. Since the SDK requires Node 22.12+, this is guarded by EC-1, but worth a defensive test.

### EC-6: YAML frontmatter parsing edge — skill with trailing whitespace in `paths:` breaks Claude Code
- **Affected task:** T3.*
- **Suggested test:** `test_all_skills_frontmatter_no_trailing_whitespace()` — parse each SKILL.md, verify no trailing whitespace in YAML values. Claude Code's YAML parser may silently fail on `paths:  ` (double space + no value).

## DOCUMENT

### EC-7: Consumer's project may conflict with skill paths
- **Accepted risk:** A consumer with a directory named `memory/` that has nothing to do with TheoKit Memory will get the memory skill injected. This is inherent to the `paths:` approach. The consumer can delete unwanted skills. Documenting in CLAUDE.md's "Customization" section is sufficient.

### EC-8: Skills cannot reference `node_modules/@theokit/sdk/docs/` (the "bundled docs" part of D1/grill Q2)
- **Accepted risk:** The plan's grill decided on (A)+(C) — CLI scaffold + docs bundled in node_modules. However, the current plan only implements (A) — the scaffold copies self-contained skills. The (C) part (skills referencing `node_modules/` docs via `@` import) is not implemented because Claude Code `@path` imports must resolve relative to the project root, and `node_modules/` paths are fragile across package managers. The skills are self-contained as a pragmatic simplification. If skills need to grow beyond 300 lines, (C) can be revisited with a dedicated ADR.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 3 | 1 (EC-1) | 2 (EC-4, EC-5) | 0 |
| T2.1 | 1 | 1 (EC-2) | 0 | 0 |
| T2.2 | 0 | 0 | 0 | 0 |
| T2.3 | 0 | 0 | 0 | 0 |
| T2.4 | 0 | 0 | 0 | 0 |
| T3.* | 4 | 1 (EC-3) | 1 (EC-6) | 2 (EC-7, EC-8) |

**Verdict: PLAN NEEDS ADJUSTMENT**

The 3 MUST FIX items require plan changes:
1. **EC-1:** Add Node version check to `init-claude.mjs` (minor — 3 lines in T1.1)
2. **EC-2:** Add drift-check script as sub-task in T2.1 (medium — new CI script)
3. **EC-3:** Differentiate `paths:` per skill domain (significant — changes all 15 skill frontmatters from `["**/*.ts"]` to domain-specific patterns). Without this fix, the passive strategy injecting ~3000 lines on every `.ts` edit defeats the purpose of on-demand loading.
