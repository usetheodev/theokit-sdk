# Forked Agent Pattern

> Para sub-tasks com **scope restrito** (background review, curator,
> kanban worker), forke um Agent novo com **credenciais e prompt-cache
> key do parent** mas **toolset reduzido**. Run no thread isolado, sem
> tocar message history do parent. Hermes usa esse pattern em 3 lugares
> (background review, curator LLM pass, kanban dispatcher worker) — 26%
> economia de custo via cache hit, isolamento via per-thread tool whitelist.

## Quando aplicar

Aplique quando precisa de "agent secundário" que:

- Compartilha credentials + prompt cache do parent
- Mas tem scope reduzido (subset de tools)
- Não deve poluir history do parent
- Roda em background ou sync mas em isolation

Exemplos canônicos:

- Background review depois de turn (memory/skill saves)
- Skill curator (LLM grading pass)
- Kanban worker assigned to specific task
- Multi-agent delegation (`delegate_tool`)

Não aplique quando:

- Sub-agent precisa de CREDENCIAIS DIFERENTES (diferente provider, API key)
- Trabalho é trivial (use direct function call, não LLM)
- User precisa interagir com sub-agent diretamente (use new session)

## Pattern canonical (Python — Hermes)

```python
# run_agent.py:4230 (background review)
def _spawn_background_review(
    self,
    messages_snapshot: List[Dict],
    review_memory: bool = False,
    review_skills: bool = False,
) -> None:
    """Spawn a background thread to review the conversation for memory/skill saves."""
    
    # 1. Thread daemon, stdout silenced
    threading.Thread(target=self._run_review, daemon=True).start()

def _run_review(self):
    # 2. Auto-deny dangerous-command approval (avoid TUI deadlock)
    install_approval_callback(_bg_review_auto_deny)
    
    # 3. Capture parent runtime — CRITICAL: same byte-identical system prompt
    parent_runtime = self._current_main_runtime()  # {provider, model, base_url, api_key, api_mode}
    
    # 4. Create forked agent
    review_agent = AIAgent(
        model=self.model,
        max_iterations=16,
        quiet_mode=True,
        provider=self.provider,
        api_mode=parent_runtime["api_mode"],
        base_url=parent_runtime["base_url"],
        api_key=parent_runtime["api_key"],
        credential_pool=self._credential_pool,
        parent_session_id=self.session_id,  # for traceability
    )
    review_agent._memory_write_origin = "background_review"  # provenance
    review_agent._cached_system_prompt = self._cached_system_prompt  # ← KEY
    
    # 5. Tool whitelist via per-thread state
    review_whitelist = {"memory_add", "memory_search", "skill_view", "skill_manage"}
    set_thread_tool_whitelist(review_whitelist, deny_msg_fmt="Not available in review fork")
    
    try:
        # 6. Run with fork-specific prompt
        prompt = "Review this turn. Save useful memories. Create/patch skills as needed."
        review_agent.run_conversation(
            user_message=prompt,
            conversation_history=messages_snapshot,
        )
    finally:
        clear_thread_tool_whitelist()
        review_agent.shutdown_memory_provider()
```

## TypeScript equivalent

```typescript
// packages/sdk/src/internal/runtime/fork-agent.ts
import { AsyncLocalStorage } from "node:async_hooks";

interface ForkOptions {
  messagesSnapshot: ReadonlyArray<SDKMessage>;
  allowedTools: Set<string>;
  systemPrompt?: string; // override; default inherits parent
  maxIterations?: number;
  prompt: string;
}

const toolWhitelistStore = new AsyncLocalStorage<Set<string>>();

export async function forkAgent(
  parent: Agent,
  options: ForkOptions,
): Promise<ForkResult> {
  // 1. Inherit runtime
  const parentRuntime = parent.getRuntime(); // provider, model, baseUrl, apiKey
  
  // 2. Create forked agent with INHERITED system prompt (byte-identical for cache)
  const fork = await Agent.create({
    apiKey: parentRuntime.apiKey,
    model: parentRuntime.model,
    provider: parentRuntime.provider,
    baseUrl: parentRuntime.baseUrl,
    
    // CRITICAL: byte-identical system prompt = cache hit on parent's prefix
    systemPrompt: options.systemPrompt ?? parent.getSystemPrompt(),
    
    // Override: limited iteration budget
    maxIterations: options.maxIterations ?? 16,
    
    // Memory provider inherited (writes go through, attribution: fork)
    memory: parent.getMemory(),
    
    // Tool whitelist enforced via AsyncLocalStorage (não global)
    tools: parent.getTools().filter((t) => options.allowedTools.has(t.name)),
    
    // Metadata for traceability
    metadata: {
      parentSessionId: parent.sessionId,
      forkType: "background_review",
    },
  });

  // 3. Run inside isolated context — whitelist enforcement
  return toolWhitelistStore.run(options.allowedTools, async () => {
    const run = await fork.send(options.prompt, {
      conversationHistory: options.messagesSnapshot,
    });
    const result = await run.wait();
    
    // 4. Cleanup
    await fork.dispose();
    
    return {
      result,
      toolCallsLog: result.toolCalls,
      tokensUsed: result.usage,
    };
  });
}

// Tool dispatch checks whitelist:
export function checkToolWhitelist(toolName: string): { allowed: boolean; reason?: string } {
  const whitelist = toolWhitelistStore.getStore();
  if (whitelist === undefined) return { allowed: true }; // not in fork
  if (!whitelist.has(toolName)) {
    return {
      allowed: false,
      reason: `Tool "${toolName}" not available in this fork context`,
    };
  }
  return { allowed: true };
}
```

## Why AsyncLocalStorage (not global state)

Python Hermes uses `threading.local()` para per-thread whitelist. Razão:
parallel forks (e.g., multiple users em gateway, multiple kanban workers)
podem ter whitelists DIFERENTES.

TypeScript não tem true threads (a menos que use Worker), MAS tem
async-context propagation via AsyncLocalStorage:

```typescript
// Wrong: global mutable state
let _toolWhitelist: Set<string> | null = null;
// ☹ Two parallel forks corrompem o state um do outro

// Right: AsyncLocalStorage propaga por await chain
const toolWhitelistStore = new AsyncLocalStorage<Set<string>>();
// ✅ Cada fork tem own context, isolated
```

Tool dispatch reads whitelist via `.getStore()` — automaticamente vê
o whitelist do fork ativo, sem global mutation.

## Architectural decisions

### AD-1: Byte-identical system prompt = cache hit

`review_agent._cached_system_prompt = self._cached_system_prompt`
(Hermes' line 113). Sem isso, fork manda system prompt diferente,
Anthropic / OpenAI cache miss, fork costs full price.

Hermes mede 26% economia de custo em Sonnet 4.5 com this pattern (issue
#25322, PR #17276).

**Lesson para TS**: fork agent shares parent's systemPrompt byte-identical.
Override só se você ACEITA cache miss.

### AD-2: `api_mode` downgrade quando necessário

Hermes detecta:

```python
if api_mode == "codex_app_server":
    api_mode = "codex_responses"  # downgrade for fork
```

Razão: codex_app_server requer specific runtime que fork não tem.
Downgrade preserva functional behavior.

Lesson: documente cases especiais. Mas em TS, raramente importa
porque transports são uniformes.

### AD-3: Auto-deny dangerous-command approval

Background fork não pode pausar para user approval (deadlock). Approval
callback:

```typescript
async function autoDenyApproval(request: ApprovalRequest): Promise<"approve" | "deny"> {
  return "deny"; // sempre nega, nunca prompt
}
```

Sem isso, fork tenta `rm -rf` → spawn approval dialog → TUI parent não
responde → deadlock (Hermes issue #15216).

### AD-4: Memory write provenance

Fork escreve em memory? Marca origem:

```typescript
const fork = await Agent.create({
  // ...
  memory: parentMemory,
  metadata: {
    memoryWriteOrigin: "background_review",
  },
});
```

User vê depois: "These 3 memory entries created by background_review".
Permite undo seletivo ("undo last review writes") sem afetar
user-confirmed writes.

## Failure modes prevenidos

1. **Cache invalidation no fork**: system prompt different → 10x cost.
   Pattern: byte-identical inheritance.

2. **Cross-fork tool bleed**: fork A whitelist `[memory]`, fork B
   whitelist `[skills]`, com global var ambos veriam `[memory, skills]`.
   Pattern: AsyncLocalStorage isolation.

3. **Approval deadlock**: fork hits danger → wait for user → user
   esperando fork terminate → deadlock.
   Pattern: auto-deny approval.

4. **Memory pollution**: fork adiciona spurious memories, user não consegue
   identificar source.
   Pattern: provenance metadata.

5. **History pollution**: fork tool calls aparecem no parent's
   conversation history.
   Pattern: snapshot-based — fork runs against `messagesSnapshot`
   (copy), never mutates parent's `messages[]`.

## Failure modes NÃO prevenidos

- **Fork crash silenciado**: `daemon=True` em Python (ou unhandled
  rejection em JS) suprime exception. Defesa: log errors em
  `console.error` + structured logger.

- **Fork token consumption**: fork conta budget contra Agent.create
  total. Se max_iterations = 16, fork pode usar 16 turns inteiros.
  Defesa: cap explícito + monitoring.

- **Parent já terminated quando fork escreve**: race entre fork
  completing memory write e parent doing `Agent.dispose()`. Defesa:
  parent espera forks pendentes em dispose.

## Como testar

```typescript
it("fork inherits parent's system prompt byte-identical", async () => {
  const parent = await Agent.create({ systemPrompt: "You are A.", ... });
  const fork = await forkAgent(parent, {
    messagesSnapshot: [],
    allowedTools: new Set(),
    prompt: "review",
  });
  
  expect(fork.systemPrompt).toBe("You are A."); // byte-identical
});

it("tool whitelist enforced via AsyncLocalStorage", async () => {
  const parent = await Agent.create({ ..., tools: [searchTool, shellTool] });
  
  await forkAgent(parent, {
    messagesSnapshot: [],
    allowedTools: new Set(["search_tool"]),
    prompt: "...",
  });
  
  // Inside fork, only searchTool was callable.
  // shellTool calls would return deny message.
});

it("parallel forks have independent whitelists", async () => {
  const parent = await Agent.create({ tools: [tool1, tool2, tool3] });
  
  const [fork1, fork2] = await Promise.all([
    forkAgent(parent, { allowedTools: new Set(["tool1"]), ... }),
    forkAgent(parent, { allowedTools: new Set(["tool2"]), ... }),
  ]);
  
  // Each fork saw only its own tool — no bleed.
});

it("memory writes by fork carry origin metadata", async () => {
  const memory = new MockMemory();
  const parent = await Agent.create({ memory, ... });
  await forkAgent(parent, { ..., memoryWriteOrigin: "review" });
  
  expect(memory.lastWrite.metadata.origin).toBe("review");
});
```

## Onde wirar no SDK

`packages/sdk/src/internal/runtime/`:

- `fork-agent.ts` — `forkAgent(parent, options)`, `checkToolWhitelist`
- `async-local-storage.ts` — `toolWhitelistStore` + `withToolWhitelist`
- Public: `Agent.fork(options)` shorthand

## Referências cruzadas

- [prompt-cache-discipline.md](./prompt-cache-discipline.md) — byte-identical = cache hit
- [tool-registry-pattern.md](./tool-registry-pattern.md) — toolset filter para fork
- [async-iterable-streaming.md](./async-iterable-streaming.md) — fork pode emitir events para parent
- [judge-call-pattern.md](./judge-call-pattern.md) — judge often runs as fork

## Citações primárias

- `referencia/hermes-agent/run_agent.py:4230` — `_spawn_background_review`
- `referencia/hermes-agent/run_agent.py:4168-4500` — fork lifecycle
- `.claude/knowledge-base/hermes-deep-dive/03-autonomous-skills.md:84-145` — happy path
- Issue #25322, PR #17276 — 26% cache savings via byte-identical prompt
- Issue #15216 — TUI deadlock from approval prompt
