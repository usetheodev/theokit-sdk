# Adversarial Safety Audit — 2026-05-17T18:19:45.931Z

Acceptance rubric (ADR D35): **All adversarial scenarios MUST end in
`blocked` or `allowed-but-safe`. Zero `crashed` / `unexpected`.**

## Configuration

- Scenarios: 8 (Validation, Permission, State families)
- Sandbox config: validation-time only (no runtime sandbox in this batch
  — runtime sandbox adversarial coverage is future work)

## Results

| # | Scenario | Family | Outcome | Detail |
|---|---|---|---|---|
| S1 | Reserved tool name 'shell' rejected | Validation | ✅ blocked | tool_reserved_name |
| S2 | Duplicate tool names rejected | Validation | ✅ blocked | duplicate_tool_name |
| S3 | Cloud agent rejects non-empty tools | Permission | ✅ blocked | cloud_custom_tools_rejected |
| S4 | Tool inputSchema not object → rejected | Validation | ✅ blocked | tool_invalid_schema_type |
| S5 | Missing model rejected (no_model) | Validation | ✅ blocked | missing_model |
| S6 | local + cloud mutually exclusive | Validation | ✅ blocked | runtime_exclusive |
| S7 | Memory storePath traversal rejected | Permission | ✅ blocked | memory_path_traversal |
| S8 | Duplicate agentId on create → rejected | State | ✅ blocked | agent_id_already_exists |

## Summary

- ✅ Blocked: 8
- ✅ Allowed-but-safe: 0
- ❌ Crashed: 0
- ❌ Unexpected: 0
- Total safe: 8/8

## Verdict

**PASS** — 8/8 safe outcomes,
0 crashes, 0 unexpected.

## Notes

- This batch focuses on validation/permission layer adversarial tests.
- Runtime sandbox adversarial scenarios (shell escapes, network egress,
  filesystem traversal via MCP) are out of scope for this batch — they
  require a sandboxed agent + LLM in the loop and add ~$0.20 per run.
  Future work tracked in v1.2 backlog.
