# Gap Analysis — what `peer-js` has that `@theokit/sdk` lacks

Phase 4. 11 gaps (each cites a real reference file:line + snippet), absences verified by grep against `packages/`. 4 target-better findings recorded for balance.

## Gaps by severity

### High
1. **OAuth2/OIDC credential exchange + refresh** — `core/src/auth/auth_handler.ts:19` (`export class AuthHandler {`). Target has only API-key auth. → port exchanger/refresher/registry.
2. **Policy-engine security plugin (allow/deny + confirmation)** — `core/src/plugins/security_plugin.ts:88` (`export class SecurityPlugin extends BasePlugin {`). Target has `pre_tool_call` veto but no policy engine / human-in-the-loop confirmation.
3. **Relational/ORM session persistence (multi-DB)** — `core/src/sessions/database_session_service.ts:66`. Target persists conversations to fs/memory only. Durability primitives (sqlite-cas/wal/atomic-write) already exist to build on.
4. **Cross-language conformance / integration / e2e test tiers green-gated** — `peer-js/vitest.config.ts`. Target excludes `tests/contract/**` + golden suites (RED roadmap); contract not enforced by default.

### Medium
5. **Artifact (file output) service with versioning** — `core/src/artifacts/base_artifact_service.ts:105`.
6. **Typed composite-agent primitives (Sequential/Parallel/Loop/Routed)** — `core/src/agents/sequential_agent.ts:41`, `loop_agent.ts:50`.
7. **Agent-as-tool (AgentTool)** — `core/src/tools/agent_tool.ts`.
8. **Pluggable context-compaction strategy interface** — `core/src/context/base_context_compactor.ts:12`.
9. **Structured code-executor with retry (Python/JS)** — `core/src/code_executors/base_code_executor.ts:50` (`errorRetryAttempts=2`).

### Low
10. **gen_ai OTEL semantic conventions on spans** — `core/src/telemetry/tracing.ts`.
11. **Open public model/provider registration hook (by regex)** — `core/src/models/registry.ts:91` (`static register<T extends BaseLlm>(`).

## Where the target is BETTER (info findings)
- **Error handling** — typed taxonomy + isRetryable + closed union (`errors.ts:142`) vs reference plain-Error/event-data.
- **Provider breadth** — 6 providers in-box vs Gemini-first.
- **Native-bindings discipline** — ABI preflight (ADR D01) + publint/attw dual-format validation; reference has no equivalent.
- **DX** — `Agent.prompt` one-shot + façade/builder/factory vs reference's explicit Runner DI.

## Quality gate
PASS (0.91). Every gap has reference_file + line + snippet + suggestion + dimension_id; absences grep-verified.
