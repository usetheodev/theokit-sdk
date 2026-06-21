# Blueprint: M3-4 — Rich errors (self-correction on tool fail)

> Design source for `withToolResultGuidance(tool, guidance)` + a shared `DEFAULT_TOOL_GUIDANCE` error-code→hint map in `@theokit/sdk-tools` — a composable wrapper that augments a built-in tool's `{ok:false,error}` JSON payload with an LLM-actionable `guidance` string, never throwing and never altering an `ok:true` result. Backed by opencode (`tool/invalid.ts` actionable failure output, `tool/edit.ts` fuzzy edit-failure feedback), codex (`apply_patch.rs` `FunctionCallError::RespondToModel("patch rejected: {reason}")`), and the in-repo Hermes recovery-hint pattern (`sdk-references/tool-call-failure-recovery.md`, `error-context-surfacing.md`) + the `defineTool` string-return contract + the 13-tool error inventory. Discovery plan: `m3-rich-errors` (discover-plan-confidence SHIPPABLE 100).

**Slug:** `m3-rich-errors` · **Date:** 2026-06-21 · **Owner:** paulo

## Context

Greenfield: no built-in tool attaches a `guidance` field; no wrapper exists. `defineTool`'s handler returns a JSON STRING (`packages/sdk/src/define-tool.ts:25`), so guidance is injected INSIDE the stringified `{ok:false,error,...}` object. 13 tools return flat `{ok:false,error:<code>,...}` shapes with no recovery hint. The wrapper is composable (KISS) — it avoids editing 13 factories while letting any tool (built-in or custom) gain guidance.

## Objective

Decide the `withToolResultGuidance(tool, guidance)` wrapper signature, the `DEFAULT_TOOL_GUIDANCE` map, the additive injection algorithm, and the never-throw passthrough contract — node-builtin-only (JSON), zero new deps — so a failing tool tells the LLM how to self-correct. Backed by opencode + codex + the in-repo Hermes pattern + the tool inventory.

## Coverage Corner 1 — Integration Tests

| Source | What it tests | Seeds these SDK RED tests |
|---|---|---|
| opencode `tool/edit.ts` (`.claude/knowledge-base/reference/opencode/packages/opencode/src/tool/edit.ts`) | edit failure produces a similarity-ranked, actionable message | wrapped `edit_file` `no_match` → guidance suggests re-reading the file / checking exact text |
| in-repo `sdk-references/tool-call-failure-recovery.md` | dispatchTool returns an error message string back to the model | wrapped tool `ok:false` → guidance string present in the returned JSON |
| in-repo tool tests (`packages/sdk-tools/tests/*.test.ts`) | each tool's `{ok:false,error}` shape | wrapper preserves the original payload + only ADDS `guidance` |

**SDK RED test set:** `ok:false` with a known code gets `guidance`; `ok:true` is returned UNCHANGED; unknown code → no guidance; non-JSON handler output → passthrough verbatim; an existing `guidance` is preserved; `withDefaultGuidance(readTool)` injects the default hint for `not_found`.

## Coverage Corner 2 — Dependencies

| Project | Guidance-injection deps | Portable? |
|---|---|---|
| opencode | Effect runtime (tool result is an Effect) | NO |
| codex | Rust `FunctionCallError` enum | concept only |
| in-repo | `JSON.parse`/`JSON.stringify` only | YES — direct |

**Verdict:** ZERO new deps — the wrapper parses the handler's returned JSON string, augments on `ok:false`, and re-stringifies. Pure string transform (Unbreakable Rule 9 / KISS).

## Coverage Corner 3 — Tools

Module / export shape:
- `defineTool` (`packages/sdk/src/define-tool.ts:25`): `handler: (input) => string | Promise<string>` — returns a STRING. `CustomTool` (`packages/sdk/src/types/agent-prims.ts`).
- opencode `tool/invalid.ts` (`.claude/knowledge-base/reference/opencode/packages/opencode/src/tool/invalid.ts:13-18`): an `execute` returning `{ output: "The arguments provided to the tool are invalid: ${error}" }` — the actionable-failure principle.
- codex `apply_patch.rs:71` (`.claude/knowledge-base/reference/codex/codex-rs/core/src/apply_patch.rs`): `FunctionCallError::RespondToModel(format!("patch rejected: {reason}"))` — a failure becomes a model-facing actionable message.

**SDK module shape:** `packages/sdk-tools/src/internal/tool-guidance.ts`, barrel-exported:
```
type ToolGuidanceMap = Record<string, string>            // errorCode → hint
withToolResultGuidance(tool: CustomTool, guidance: ToolGuidanceMap): CustomTool
  // returns a new CustomTool whose handler awaits the inner result, then injectGuidance(result, guidance)
DEFAULT_TOOL_GUIDANCE: ToolGuidanceMap                    // curated hints for the common codes
withDefaultGuidance(tool: CustomTool): CustomTool         // = withToolResultGuidance(tool, DEFAULT_TOOL_GUIDANCE)
injectGuidance(handlerOutput: string, guidance: ToolGuidanceMap): string   // pure, exported for testing
```

## Coverage Corner 4 — Techniques

### Technique 1 — additive guidance injection (Q4)

```
injectGuidance(output, guidance):
  let parsed
  try { parsed = JSON.parse(output) } catch { return output }      // non-JSON → passthrough
  if (!isObject(parsed) || parsed.ok !== false) return output      // ok:true / not-our-shape → unchanged
  if (typeof parsed.guidance === "string") return output           // preserve existing (idempotent, EC-2)
  const hint = guidance[parsed.error]
  if (!hint) return output                                         // unknown code → no guidance
  return JSON.stringify({ ...parsed, guidance: hint })
```
`withToolResultGuidance(tool, guidance)` returns `defineTool({ ...tool-fields, handler: async (input) => injectGuidance(await tool.handler(input), guidance) })` — or constructs the `CustomTool` directly preserving name/description/inputSchema.

### Technique 2 — DEFAULT_TOOL_GUIDANCE curated hints + never-throw passthrough (Q5)

Curated for the common codes across the inventory (advisory, LLM-actionable):
| error code | guidance |
|---|---|
| `not_found` | "The path does not exist. Use `list_dir` or `glob_files` to find the correct path, then retry." |
| `path_traversal` / `forbidden_path` | "That path is outside the project or is a protected file. Use a path inside the project root." |
| `no_match` | "The search text was not found verbatim. Re-read the file with `read_file` and copy the exact text (including whitespace) before editing." |
| `no_matches` | "No files matched. Broaden the glob pattern or check the directory with `list_dir`." |
| `timeout` | "The operation timed out. Try a narrower scope or a longer `timeout_ms`." |
| `ssrf_blocked` | "That host is private/loopback/reserved and is blocked. Use a public URL." |
| `catastrophic_command` | "That command is blocked as catastrophic. Use a safer, scoped command (e.g. a relative path)." |
| `binary_file` / `too_large` | "The file is binary or too large to read directly. Use a different tool or a bounded range." |

Passthrough rules (never-throw, EC-1/EC-3): non-JSON output → unchanged; `ok:true` → unchanged; not-our-shape → unchanged; unknown code → unchanged; existing `guidance` → preserved. The wrapper never throws and never removes/alters existing fields (only adds `guidance`).

## Cross-cutting Comparison

| Dimension | codex | opencode | in-repo Hermes | SDK decision |
|---|---|---|---|---|
| Failure → model | `FunctionCallError::RespondToModel(msg)` | actionable `output` string | error message in `tool_result.content` | additive `guidance` field on `{ok:false}` |
| Mechanism | Rust enum | Effect | string | pure JSON string transform |
| Granularity | per-call message | per-tool | per-dispatch | per-error-code map |
| Deps | Rust std | Effect | none | none |
| Modifies success? | n/a | no | no | NO (ok:true untouched) |

## ADRs

### D1 — Composable wrapper, not 13 factory edits
**Decision:** ship `withToolResultGuidance(tool, guidance)` + `DEFAULT_TOOL_GUIDANCE` + `withDefaultGuidance(tool)` + a pure `injectGuidance` — compose over the existing tools instead of editing each factory.
**Rationale:** KISS/YAGNI + low risk; works for built-in AND custom tools; the roadmap's "each factory attaches guidance" is satisfied by wrapping at composition time.
**Alternatives considered:** edit all 13 factories (rejected — 13 risky diffs, no extra value); a base-class (rejected — tools are factories, not classes).

### D2 — Guidance injected INSIDE the JSON string (handler contract)
**Decision:** since `handler` returns a string, the wrapper parses → augments → re-stringifies; guidance is a `guidance` field in the `{ok:false}` object.
**Rationale:** matches the `defineTool` string-in/string-out contract; the model already parses the JSON and will see `guidance`.
**Alternatives considered:** wrap in an outer object (rejected — breaks the established `{ok,...}` shape consumers parse).

### D3 — Additive + idempotent + never-throw passthrough
**Decision:** inject ONLY when `ok===false` AND a hint exists AND no `guidance` already present; non-JSON / `ok:true` / unknown code / parse error → return the original string unchanged; never throw.
**Rationale:** safety — the wrapper must never corrupt a result or break a custom tool that returns non-JSON (EC-1/EC-2/EC-3).
**Alternatives considered:** overwrite existing guidance (rejected — destroys a tool's own hint); throw on non-JSON (rejected — breaks legit non-JSON tools).

### D4 — Curated DEFAULT_TOOL_GUIDANCE for common codes (not all 31)
**Decision:** ship hints for the cross-tool common codes (not_found, path_traversal, forbidden_path, no_match, no_matches, timeout, ssrf_blocked, catastrophic_command, binary_file, too_large); unknown/rare codes simply get none.
**Rationale:** the common codes carry the most self-correction value; YAGNI on the long tail; consumers can supply their own map.
**Alternatives considered:** exhaustively map all 31 (rejected — diminishing returns, churn).

### D5 — Placement + barrel export
**Decision:** `packages/sdk-tools/src/internal/tool-guidance.ts`; export `withToolResultGuidance`, `withDefaultGuidance`, `DEFAULT_TOOL_GUIDANCE`, `injectGuidance`, `ToolGuidanceMap` from the barrel.
**Rationale:** sibling of the tools it wraps; internal/ for logic, barrel for reuse.
**Alternatives considered:** in `@theokit/sdk` core (rejected — it wraps sdk-tools' tools).

## Recommendations for the project

1. Implement `withToolResultGuidance(tool, guidance)` + pure `injectGuidance` + `DEFAULT_TOOL_GUIDANCE` + `withDefaultGuidance` in `packages/sdk-tools/src/internal/tool-guidance.ts`, zero deps, barrel-exported (D1/D5).
2. Inject guidance INSIDE the JSON string, additive-only on `ok:false`, idempotent, never-throw passthrough on non-JSON / ok:true / unknown code (D2/D3).
3. Curate `DEFAULT_TOOL_GUIDANCE` for the common cross-tool codes; let consumers extend with their own map (D4).
4. TDD must include: ok:false+known code → guidance; ok:true untouched; unknown code → none; non-JSON → passthrough; existing guidance preserved; `withDefaultGuidance` end-to-end on a real built-in tool.
5. Defer editing the 13 factories inline; the wrapper is the composition point (M3-4 done; per-factory opt-in later if wanted).

## Blocked questions (if any)

- (none) — design fully resolved; the wrapper composes over existing tools with zero deps.
