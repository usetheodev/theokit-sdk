# Edge Case Review — system-prompt-support

Data: 2026-05-15
Tasks analisadas: 9 (T1.1, T1.2, T2.1, T3.1, T4.1, T4.2, T5.1, T5.2, T6.1)
Edge cases encontrados: 6 (MUST FIX: 1, SHOULD TEST: 3, DOCUMENT: 2)

---

## MUST FIX

### EC-1: Cloud agents silently ignore `systemPrompt`

- **Task afetada:** T3.1 (escopo incompleto)
- **Família:** Integration
- **Cenário:** Plan's T1.2 deep-dependency note says "LocalAgent.send and CloudAgent.send both read this", but T3.1 only wires `LocalAgent`. A user doing `Agent.create({ cloud: {...}, systemPrompt: "..." })` will see the field on the public type, pass it without error, and watch it be silently dropped — `CloudAgent.send` (`packages/sdk/src/internal/runtime/cloud-agent.ts:45-58`) currently passes only `agentId, model, message, agentOptions, sendOptions` into `createCloudRun`, and `real-cloud-run.ts:postRun` POSTs only `{ message, mcpServers }` to PaaS.
- **Impacto:** Silent failure mode. The user's intent is dropped; behavior diverges from `LocalAgent` for no documented reason. Worst class of bug: type checks pass, no error fires, output is just wrong.
- **Fix sugerido:** Add one sentence to T3.1 + one paragraph to the plan: "Cloud runtime path: thread `resolvedSystemPrompt` into `real-cloud-run.ts` body as `systemPrompt` field. Fixture cloud path (`cloud-run.ts`) accepts and ignores like the fixture local path." OR, if v1 is local-only: in `CloudAgent.send`, throw `ConfigurationError("systemPrompt is not yet supported for cloud agents")` when `options.systemPrompt ?? this.options.systemPrompt` is defined. Either way — don't leave it silent.

---

## SHOULD TEST

### EC-2: Resolver returns non-string at runtime

- **Task afetada:** T2.1
- **Teste sugerido:** `test_resolver_returns_non_string_coerces_to_undefined()` — given resolver `() => null as unknown as string`, `resolveSystemPrompt` must return `undefined` (not pass `null` through to the LLM, which would crash JSON serialization or send `"null"` as the system prompt). TypeScript prevents this at compile time, but `as` casts and JS callers bypass that.
- **Fix em 2 linhas dentro de `resolveSystemPrompt`:**
  ```ts
  const resolved = await agent(ctx);
  return typeof resolved === "string" ? resolved : undefined;
  ```

### EC-3: `skillsManager` is undefined when resolver invocation needs `ctx.skills`

- **Task afetada:** T3.1
- **Teste sugerido:** `test_buildSystemPromptContext_with_no_skillsManager_returns_empty_skills()` — when `AgentOptions.local.settingSources` does NOT include `"project"` and no `skills` config is provided, `this.skillsManager` is `undefined` (per `local-agent.ts:78`). The plan's T3.1 says "lazy skills resolution: call `skillsManager.list()` when resolver is a function" without guarding for `undefined`. A `TypeError: Cannot read properties of undefined (reading 'list')` would crash `send()` for any agent without skills enabled.
- **Fix em 1 linha:**
  ```ts
  const skills = this.skillsManager ? await this.skillsManager.list() : [];
  ```

### EC-4: Empty-string override is honored (not coerced to undefined)

- **Task afetada:** T2.1 (already in TDD list as `respects_empty_string_from_resolver`, but only for the resolver path — not the override path)
- **Teste sugerido:** `test_resolves_empty_string_override()` — given `override === ""`, `resolveSystemPrompt` must return `""`, NOT fall through to the agent's `systemPrompt`. The current priority logic (`if (override !== undefined) return override`) handles this correctly, but a future refactor to `if (override) return override` (truthy check) would break it silently. A test pins down the contract.
- **No code change needed if logic is `!== undefined`** — just adding the test prevents drift.

---

## DOCUMENT

### EC-5: Long-running / hung resolvers block `send()` indefinitely

- **Risco aceito:** The plan does not impose a timeout on the resolver. A user resolver that hits the network without a timeout, awaits a never-resolving promise, or spins on a hot loop will make `agent.send()` hang forever. The fix (wrap in `Promise.race` with a configurable timeout) adds a knob to the public surface for a problem caused by user code. Per KISS, document the contract instead: "Resolvers must complete quickly. The SDK does not impose a timeout — wrap your own `Promise.race` if you call out to slow systems."
- **Where to document:** JSDoc on `SystemPromptResolver` in `types/agent.ts` + one bullet in the docs.md SystemPromptContext section.

### EC-6: Subagents do NOT inherit parent `systemPrompt`

- **Risco aceito:** Subagents (`AgentDefinition`) already carry their own `prompt` field (`packages/sdk/src/types/agent.ts:92`) which serves as their system context. The plan does not address whether a spawned subagent should inherit the parent's `systemPrompt` in addition to its own `prompt`. By default it will not — they're separate code paths. This is the intended behavior (subagents are isolated by design per `docs.md:958+`) but a user could reasonably expect inheritance. Document the non-inheritance explicitly.
- **Where to document:** Add a one-liner to the AgentOptions section of `docs.md` adjacent to `systemPrompt`: "Subagents do not inherit this prompt — they use their own `AgentDefinition.prompt` field exclusively."

---

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T1.1 | 0 | 0 | 0 | 0 |
| T1.2 | 0 | 0 | 0 | 0 |
| T2.1 | 2 | 0 | 2 (EC-2, EC-4) | 0 |
| T3.1 | 2 | 1 (EC-1) | 1 (EC-3) | 0 |
| T4.1 | 0 | 0 | 0 | 0 |
| T4.2 | 0 | 0 | 0 | 0 |
| T5.1 | 1 | 0 | 0 | 1 (EC-6) |
| T5.2 | 0 | 0 | 0 | 0 |
| T6.1 | 1 | 0 | 0 | 1 (EC-5) |

**Veredicto:** PLANO PRECISA DE AJUSTE

Razão única: EC-1 (CloudAgent silently ignores `systemPrompt`) is the type of gap that creates a "production-only" bug. The plan needs an explicit decision recorded as ADR D7: either *"v1 also wires CloudAgent path"* or *"v1 is local-only; CloudAgent.send throws ConfigurationError when systemPrompt is set"*.

Os outros 5 edges são absorvidos por:
- 3 testes adicionais (≤6 linhas de teste cada) em T2.1 e T3.1.
- 2 parágrafos de documentação em T5.1.

Nenhum dos 6 edge cases justifica nova abstração, novo módulo, ou retry/timeout/circuit-breaker infra. Todos resolvem com `if`/`??`/typeof check ou uma frase no docs.md.
