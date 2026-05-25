# System Context — `runtime` domain (BASELINE 2026-05-25)

Captured before production-readiness plan implementation. Diff against post-implementation to verify architecture changes are intentional.

## Boundary diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                  Caller (TheoKit / examples / user code)         │
│                                                                  │
│  Agent.create / Agent.getOrCreate / Agent.resume / Agent.prompt  │
│  agent.send() / agent.dispose()                                  │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼ (public API in packages/sdk/src/agent.ts)
┌─────────────────────────────────────────────────────────────────┐
│             Façade  packages/sdk/src/agent.ts                    │
│                                                                  │
│  - validateAgentOptions                                          │
│  - hydrateRegistryFromDisk                                       │
│  - maybeInjectHandoffTools                                       │
│  - createLocalAgent / createCloudAgent                           │
└────────┬──────────────────────────────────┬─────────────────────┘
         │                                  │
         ▼ (local path)                     ▼ (cloud path)
┌─────────────────────────┐         ┌─────────────────────────┐
│ internal/runtime/       │         │ internal/runtime/       │
│   local-agent.ts        │         │   cloud-agent.ts        │
│   local-agent-*.ts (8)  │         │   cloud-*.ts (4)        │
│   real-local-run.ts     │         │   real-cloud-run.ts     │
│   agent-session.ts      │         │   (delegates to PaaS)   │
│   agent-session-store.ts│         │                         │
│   agent-registry.ts     │         └─────────────────────────┘
│   agent-registry-store  │
│   run-registry.ts       │
│   fork-agent.ts         │
│   plugins-manager.ts    │
│   skills-manager.ts     │
│   subagents-loader.ts   │
│   ... (74 files total)  │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐         ┌─────────────────────────┐
│ internal/llm/           │         │ internal/persistence/   │
│   router.ts             │         │   atomic-write.ts       │
│   anthropic.ts          │         │   cwd-mutex.ts          │
│   openai.ts             │         │   exclusive-create.ts   │
│   bedrock-anthropic.ts  │         │   file-lock.ts          │
│   vertex-*.ts           │         │   paths.ts              │
│   ollama-native.ts      │         │   sqlite-cas.ts         │
│   credential-pool.ts    │         │   sqlite-wal.ts         │
│   pool-aware-client.ts  │         │   schema-version.ts     │
│   fallback-client.ts    │         │   ... (12 files)        │
│   sse.ts                │         └─────────────────────────┘
│   ... (18 files)        │
└────────┬────────────────┘
         │
         ▼
   fetch(url, { signal })  → provider HTTPS
```

## File inventory

- `internal/runtime/`: **74 .ts files** (production)
- `internal/persistence/`: **12 .ts files**
- `internal/llm/`: 18 .ts files
- `internal/errors/`: 1 base + 5 mappers
- `internal/tool-dispatch/`: 4 files

## Critical paths today (pre-plan)

1. **Persistence:** `agent-session.ts` → `agent-session-store.ts` (`appendFile`, hard-coded `.theokit/agents/<id>/messages.jsonl`)
2. **Registry:** `agent-registry.ts` (in-memory `Map`) → `agent-registry-store.ts` (`registry.json` per cwd)
3. **GC:** **NONE** — `Map` is monotonic until `clearAgentRegistry()` is explicitly invoked (test-only)
4. **AbortSignal:** `SendOptions.signal` lands in `pre_user_send` hooks; **NOT propagated to `fetch()`** in production path (the LLM clients accept `signal` but `real-local-run.ts` does not pass it from `SendOptions`)
5. **Tool hooks:** plugin-level `pre_tool_call` / `post_tool_call` only — no `AgentOptions`-level callbacks
6. **Quota hooks:** none
