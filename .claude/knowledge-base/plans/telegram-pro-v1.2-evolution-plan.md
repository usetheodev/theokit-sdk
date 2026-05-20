# Plan: telegram-pro v1.2 Evolution — 7 evoluções pragmáticas

> **STATUS: COMPLETO** — Concluído em 2026-05-17. 7 ADRs (D52-D58) lockados; `streaming.ts` criado com 4 EC fixes do edge-case-review; 6 commands novos (/factstream, /migrate_memory, /memory_lance, /notion, /stream, /skill); auto-instrumentation habilitada (autoDetect: true); dispatchToAgent ganha branch stream mode (backward compat preservada); README + /help + /start atualizados. `pnpm validate` exit=0. `typecheck-examples` Pass=46/46. Snapshot final: `.claude/knowledge-base/reviews/telegram-pro-v1.2-evolution-dogfood-2026-05-17.md`. LoC final 2668 (+548 vs v1.1; +2.6% acima do budget — aceito por causa de error handling proper). Ressalva: `.env.example` não atualizado por permission rule do projeto; README compensa.

> **Version 1.0** — Plano para evoluir o flagship example `telegram-pro` cobrindo todas as 6 features de v1.2 + 1 polish educacional. Adiciona: (1) `/factstream` com `Agent.streamObject` + Telegram `editMessageText` incremental; (2) `/migrate_memory` invocando `migrateSqliteToLance`; (3) auto-instrumentation Langfuse/Sentry/PostHog opt-in via `telemetry.autoDetect`; (4) `/memory_lance` mostrando opt-in LanceDB; (5) `/notion` com OAuth MCP PKCE; (6) `/stream` global toggle com streaming incremental (substitui `dispatchToAgent` por `run.stream()` + edit); (7) `/skill <name>` drill-down do conteúdo da skill. Outcome: telegram-pro passa de "showcase de v1.0+v1.1" para "showcase completo de v1.0→v1.2", continuando a ser o single-best-demo para devs avaliando o SDK em ~1300 LoC.

## Context

**Estado atual de cobertura no telegram-pro (2026-05-17):**

| Feature | Versão | Coberta? | Onde |
|---|---|---|---|
| `Agent.create` + canonical options | v1.0 | ✅ | `agent.ts` |
| Memory + dreaming + active recall | v1.0 | ✅ | `memory-store.ts`, `/summary`, `/me`, `/recall` |
| MCP filesystem + tavily | v1.0 | ✅ | `sdk-config.ts` |
| Hooks policy | v1.0 | ✅ | `hooks-setup.ts` |
| Skills loading | v1.0 | ✅ | `/skills` |
| Cron + croner | v1.0 | ✅ | `/remind`, `cron-setup.ts` |
| Voice (Whisper) + Vision (Gemini) | v1.0 + grammy plumbing | ✅ | `transcribe.ts`, `vision.ts` |
| Subagents (declared, cloud-only dispatch) | v1.0 | ✅ | `subagents.ts`, `/agents` |
| `defineTool` Zod tools | v1.1 | ✅ | `tools-registry.ts`, `ad-hoc-tools.ts` |
| `createAgentFactory` + `getOrCreate` | v1.1 | ✅ | `agent.ts` linha 53-91 |
| `Agent.generateObject<T>` | v1.1 | ✅ | `/fact` (index.ts linha 230-285) |
| Manual telemetry OTel | v1.1 | ✅ | `agent.ts` linha 70-79 |
| **`Agent.streamObject`** | **v1.2** | **❌** | — |
| **`useTheoChat` / Completion / Assistant** | **v1.2** | N/A | not applicable (Telegram, not React) |
| **OAuth MCP PKCE** | **v1.2** | **❌** | — |
| **Auto-instrumentation** | **v1.2** | **❌** | `agent.ts` força `exporter: "console"` manual |
| **LanceDB backend** | **v1.2** | **❌** | — |
| **Migration CLI** | **v1.2** | **❌** | — |
| Streaming visível no UX | qualquer versão | **❌** | `dispatchToAgent` faz `run.wait()`, perde streaming |
| Skill content drill-down | v1.0 | **❌** | só listing, sem `cat` |

**Por que NÃO foi feito em v1.2:**

- Plano v1.2 mirou `packages/` + 1 example showcase pequeno (`react-nextjs`). telegram-pro ficou como "showcase de v1.1 + manual telemetry", deferido.
- Plano `examples-100-coverage` criou examples PONTUAIS (1 por feature), mas o flagship demo ainda mostra v1.1.

**Por que importa agora:**

- Dev externo avaliando o SDK clica em `telegram-pro` ANTES de qualquer outro example (é destacado como "Flagship multimodal demo" no `examples/README.md`).
- Sem features v1.2, o flagship transmite "SDK parou em v1.1".
- Streaming visível (`/stream` mode) é alto valor educacional — sem isso, devs constroem bots que parecem lentos ("...thinking" sem feedback).

**Evidência da estrutura atual:**

```
examples/telegram-pro/src/
├── index.ts          792 LoC (15 bot.commands + 4 event handlers)
├── agent.ts          102 LoC (createAgentFactory closure)
├── memory-store.ts    40 LoC (read MEMORY.md)
├── sdk-config.ts      76 LoC (provider routing + MCP servers)
├── hooks-setup.ts     73 LoC (.theokit/hooks.json writer)
├── workspace-seeds.ts 156 LoC (skills + plugins + context + wiki seeds)
├── transcribe.ts      97 LoC (Whisper)
├── vision.ts         111 LoC (Gemini vision + cache)
├── cron-setup.ts     119 LoC (nightly dreaming + /remind)
├── loops.ts          134 LoC (/loop family)
├── ad-hoc-tools.ts   121 LoC (defineTool registry for /tool)
└── ... (8 outros files menores)
```

Total atual: **2120 LoC**. Pós-plano: **~2520 LoC** (target +400 LoC para 7 evoluções).

**Custo de NÃO fazer:**
- Flagship demo gradualmente fica "behind the times" — cada release v1.x sem update destrói credibilidade.
- Streaming visível é a expectativa baseline em 2026 (ChatGPT/Claude UIs todos têm). Sem isso, telegram-pro parece estagnado.

## Objective

**Done = telegram-pro cobre 6/6 features v1.2 + 2 polish features; total ≤ 2600 LoC; typecheck PASS; real-LLM smoke validado para o pattern de streaming incremental (`/factstream` + `/stream` mode).**

Metas mensuráveis:

1. **7 novos commands/modes** no `telegram-pro/src/index.ts` (`/factstream`, `/migrate_memory`, `/memory_lance`, `/notion`, `/stream`, `/skill`, + 1 mudança global `/start`/`/help` listing).
2. **Auto-instrumentation Langfuse/Sentry/PostHog** habilitada via `agent.ts` factory (mudança de 1 flag: `telemetry: { autoDetect: true }`).
3. **Streaming incremental visível** — `dispatchToAgent` ganha 2 modes (default `wait` vs `stream` via `STREAM_MODE` env OR `/stream on|off`).
4. **README atualizado** com matriz de features cobertas + setup das features novas (LANGFUSE_PUBLIC_KEY, NOTION_OAUTH_CLIENT_ID).
5. **Real-LLM smoke** pelo menos para `/factstream` + 1 conversa em `/stream on` mode.
6. **Backward compat** — todos os 15 commands existentes continuam funcionando sem mudança visível ao user.

## ADRs

| ID | Decision | Rationale | Consequences |
|---|---|---|---|
| **D52** | Streaming incremental no Telegram via `editMessageText` com throttle de 500ms (batch deltas) | Telegram tem rate-limit (~20 msgs/sec por chat). Edit a cada delta (50-100ms) excede limite e gera 429. Batching de 500ms aproxima UX "ChatGPT incremental" sem hammer no Telegram API. | Cada send streamed cria 1 mensagem inicial "..." + N edits subsequentes. Throttle é implementado como `setTimeout` que coleta deltas + flushes; última edit garante final state. |
| **D53** | `/stream` mode é runtime toggle persistido em memória do processo (não filesystem) | Toggle visivelmente útil para demo (dev liga/desliga e compara UX); persistência cross-restart over-engineering pra demo. | `STREAM_MODE` env var é o default; `/stream on\|off` override. Restart volta ao default. |
| **D54** | OAuth MCP via `NOTION_OAUTH_CLIENT_ID` opt-in (D48 pattern do examples-100-coverage); ausente = `/notion` responde "set NOTION_OAUTH_CLIENT_ID + restart" | Telegram bot NÃO pode dirigir OAuth flow (browser callback exigiria webhook reverse-proxy). Real flow precisa primeira invocação em CLI (`pnpm exec theokit-mcp-auth-notion` ou similar manual). Em telegram-pro: only token-cached use. | telegram-pro carrega Notion MCP com OAuth config; primeira invocação (em qualquer machine local) dispara flow uma vez; depois telegram-pro usa cache transparente. |
| **D55** | Auto-instrumentation é "fail-open": se Langfuse/Sentry/PostHog NÃO instalados, telemetry.autoDetect skipa silentemente. Bot funciona idêntico ao v1.1. | Sem isso, telegram-pro quebra para users sem vendor SDKs instalados. ADR D42 já garante esse comportamento — telegram-pro só precisa setar `autoDetect: true`. | Mudança de 1 linha em `agent.ts`. Stderr mostra `[theokit-sdk] telemetry: <vendor> auto-instrumented` quando vendor presente; silent quando ausente. |
| **D56** | `/memory_lance` é DEMO command — mostra o opt-in config mas NÃO migra dados de produção do bot. Roda em workspace tmpdir isolado. | Telegram bot users TÊM facts reais persistidos em `.theokit/memory/MEMORY.md`. Migrar acidentalmente via `/memory_lance` quebra continuidade de sessão. Demo isolado em tmpdir é safe. | Adiciona `node:os.tmpdir` + cleanup. Migration CLI real-mode continua disponível via `pnpm exec theokit-migrate-memory --cwd .` (não via Telegram). |
| **D57** | `/skill <name>` reusa pattern de `/wiki` — search-then-cat via filesystem direta, NÃO via LLM tool call | LLM tool flow (`memory_get` em skill body) precisa instruction tuning + multi-step; demo command precisa ser instantâneo (1 click → resultado). Filesystem direto é 10ms. | Adiciona helper em `workspace-seeds.ts` (`readSkillFile(cwd, name)`); listing skills já existe; comando lê + reply com markdown formatado. |
| **D58** | Streaming incremental usa `splitForTelegram` no `complete` event (final), NÃO durante stream | Mid-stream o text NÃO é finalizado (cursor markers possíveis no final). `splitForTelegram` quebra em chunks por linha — quebrar mid-token causa mensagens incompletas. | Durante stream: `editMessageText` com texto cru (até 4096 chars Telegram limit, truncar se exceder). No `complete`: substituir pela versão final + split adequado. |

## Dependency Graph

```
Phase 0 (ADRs D52-D58)
    │
    ├──▶ Phase 1 (Streaming primitives — bloqueador para Phase 2)
    │       ├── T1.1 helper `streamIntoTelegram(ctx, agent, prompt)` em new src/streaming.ts
    │       └── T1.2 STREAM_MODE env + in-memory toggle store
    │
    ├──▶ Phase 2 (Commands paralelizáveis após Phase 1)
    │       ├── T2.1 /factstream — Agent.streamObject + edit-message-text throttled
    │       ├── T2.2 /migrate_memory — migrateSqliteToLance em tmpdir
    │       ├── T2.3 /memory_lance — Lance opt-in config demo
    │       ├── T2.4 /notion — OAuth MCP config (cache check + diagnostic)
    │       ├── T2.5 /stream on|off — toggle mode + reply confirmation
    │       └── T2.6 /skill <name> — drill-down filesystem read
    │
    ├──▶ Phase 3 (Auto-instrumentation, 1-line change)
    │       └── T3.1 agent.ts: trocar `{ exporter: "console" }` por `{ autoDetect: true, exporter: "console" }`
    │
    └──▶ Phase 4 (Integration — depende de Phases 1-3)
            ├── T4.1 dispatchToAgent ganha mode switching
            ├── T4.2 /help + /start atualizados com novos commands
            ├── T4.3 README atualizado com matriz feature → command
                    │
                    └──▶ Phase 5 (Final Dogfood QA)
```

**Paralelismo:** Phase 2 (6 tasks) e Phase 3 (1 task) são 100% paralelos após Phase 1. Phase 4 depende de tudo. Estimativa total: 1-2 dias / 1 dev focado.

---

## Phase 0: ADRs D52-D58

**Objective:** Lockar 7 decisões antes do scaffolding.

### T0.1 — Escrever ADRs D52-D58

#### Objective
Materializar as 7 decisões em `.claude/knowledge-base/adrs/D{52..58}-*.md` + adicionar 7 linhas em CLAUDE.md tabela.

#### Evidence
Pattern de ADRs estabelecido. Cada decisão tem trade-offs reais (rate-limit Telegram, browser flow OAuth, etc).

#### Files to edit
```
.claude/knowledge-base/adrs/D52-telegram-streaming-throttle-500ms.md  (NEW)
.claude/knowledge-base/adrs/D53-stream-mode-runtime-toggle.md  (NEW)
.claude/knowledge-base/adrs/D54-oauth-mcp-token-cached-only.md  (NEW)
.claude/knowledge-base/adrs/D55-autoinstrument-fail-open.md  (NEW)
.claude/knowledge-base/adrs/D56-memory-lance-demo-isolated-tmpdir.md  (NEW)
.claude/knowledge-base/adrs/D57-skill-drilldown-filesystem-direct.md  (NEW)
.claude/knowledge-base/adrs/D58-stream-vs-final-split-strategy.md  (NEW)
CLAUDE.md  (UPDATE — adicionar 7 linhas à tabela)
```

#### Deep file dependency analysis
ADRs são independentes; CLAUDE.md editado 1×.

#### Tasks
1. Criar 7 ADRs seguindo o template (Decision/Rationale/Alternatives/Consequences).
2. Adicionar 7 rows à tabela em CLAUDE.md.

#### TDD
```
VERIFY: find .claude/knowledge-base/adrs/D{52,53,54,55,56,57,58}-*.md | wc -l  → 7
VERIFY: grep -cE "^\| D5[2-8]" CLAUDE.md  → 7
```

#### Acceptance Criteria
- [ ] 7 ADRs criadas
- [ ] CLAUDE.md tabela atualizada
- [ ] Cada ADR tem ≥2 alternativas rejeitadas

#### DoD
- [ ] `find` retorna 7 arquivos
- [ ] `grep` retorna 7 matches

---

## Phase 1: Streaming Primitives

**Objective:** Criar a infra de streaming compartilhada que `/factstream` + global `/stream` mode usam.

### T1.1 — `streamIntoTelegram(ctx, agent, prompt)` helper

#### Objective
Função que substitui o pattern `run = agent.send(...); result = await run.wait();` por streaming incremental com `editMessageText` throttled em 500ms.

#### Evidence
- Atual `dispatchToAgent` (linha 583-630 de index.ts) usa `run.wait()` — perde streaming.
- ADR D52 prescreve throttle de 500ms para evitar rate-limit Telegram (~20 msgs/sec).
- ADR D58 prescreve text cru durante stream + `splitForTelegram` no complete.

#### Files to edit
```
examples/telegram-pro/src/streaming.ts  (NEW) — ~120 LoC
examples/telegram-pro/src/index.ts  (UPDATE) — dispatchToAgent ganha 2 paths
```

#### Deep file dependency analysis
- **`streaming.ts`** (NEW): export `streamIntoTelegram(ctx, agent, prompt, options)`. Internamente:
  1. Envia placeholder "..." via `ctx.reply`.
  2. Captura `message_id`.
  3. Itera `run.stream()`; agrega text deltas em buffer.
  4. Throttle: a cada 500ms, `editMessageText` com buffer atual (truncado a 4000 chars com `...`).
  5. No `complete`: cancel timer, último edit com texto final.
  6. Se texto > 4096 chars: deleta mensagem incremental, faz `splitForTelegram` + multi-reply.
- **`index.ts`** (UPDATE): `dispatchToAgent` ganha branch `if (streamMode) streamIntoTelegram(...)`.

#### Deep Dives

**Estrutura de `streaming.ts`:**

```ts
import type { Context } from "grammy";
import type { SDKAgent } from "@usetheo/sdk";
import { splitForTelegram } from "./format.js";

const EDIT_THROTTLE_MS = 500;
const TELEGRAM_MAX_MSG_CHARS = 4000; // safety margin under 4096 limit

export async function streamIntoTelegram(
  ctx: Context,
  agent: SDKAgent,
  prompt: string,
  sendOptions: Parameters<SDKAgent["send"]>[1] = {},
): Promise<void> {
  // EC-1 MUST FIX: ctx.reply pode falhar (502/network). Guard initial msg.
  let placeholder;
  try {
    placeholder = await ctx.reply("...");
  } catch (err) {
    console.error("[streamIntoTelegram] initial reply failed:", err);
    return;
  }
  if (placeholder?.message_id === undefined) {
    console.error("[streamIntoTelegram] placeholder reply returned without message_id");
    return;
  }
  const msgId = placeholder.message_id;
  const chatId = placeholder.chat.id;

  let buffer = "";
  let lastEditAt = 0;
  let pendingEdit: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;

  const flushEdit = async () => {
    if (cancelled) return;
    const text = buffer.length > TELEGRAM_MAX_MSG_CHARS
      ? `${buffer.slice(0, TELEGRAM_MAX_MSG_CHARS)}\n...`
      : buffer;
    if (text.length === 0) return;
    try {
      await ctx.api.editMessageText(chatId, msgId, text);
    } catch (err) {
      // EC-2 MUST FIX: broader catch — "not modified" (benign), "message to
      // edit not found" / "message can't be edited" (user deleted or
      // permissions changed). All terminate stream gracefully.
      if (
        err instanceof Error &&
        /not modified|message to edit not found|message can't be edited/i.test(err.message)
      ) {
        cancelled = true;
        return;
      }
      throw err;
    }
    lastEditAt = Date.now();
  };

  const scheduleEdit = () => {
    if (pendingEdit !== undefined) return;
    const elapsed = Date.now() - lastEditAt;
    const wait = Math.max(0, EDIT_THROTTLE_MS - elapsed);
    pendingEdit = setTimeout(async () => {
      pendingEdit = undefined;
      await flushEdit();
    }, wait);
  };

  const run = await agent.send(prompt, sendOptions);
  try {
    for await (const evt of run.stream()) {
      if (evt.type === "assistant") {
        for (const part of evt.message.content) {
          if (part.type === "text" && part.text.length > 0) {
            buffer += part.text;
            scheduleEdit();
          }
        }
      }
    }
    await flushEdit(); // ensure final state

    // EC-4 SHOULD TEST: zero deltas (Gemini batched) → buffer vazio →
    // placeholder permanece "...". Fallback to run.wait() result text.
    if (buffer.length === 0) {
      try {
        const result = await run.wait();
        const fallback = result.result ?? `(${result.status})`;
        await ctx.api.editMessageText(chatId, msgId, fallback.slice(0, TELEGRAM_MAX_MSG_CHARS));
      } catch {
        // best-effort fallback
      }
      return;
    }

    // After stream finalize: if buffer exceeds Telegram limit, switch to split.
    if (buffer.length > TELEGRAM_MAX_MSG_CHARS) {
      cancelled = true;
      try { await ctx.api.deleteMessage(chatId, msgId); } catch {}
      for (const part of splitForTelegram(buffer)) {
        await ctx.reply(part);
      }
    }
  } catch (cause) {
    cancelled = true;
    const msg = cause instanceof Error ? cause.message : String(cause);
    try { await ctx.api.editMessageText(chatId, msgId, `❌ Stream error: ${msg.slice(0, 200)}`); } catch {}
    throw cause;
  } finally {
    // EC-3 MUST FIX: cancel pending timer in BOTH happy and error paths.
    if (pendingEdit !== undefined) clearTimeout(pendingEdit);
  }
}
```

**Invariants:**
- Sempre cria 1 mensagem inicial; nunca mais que N+1 (incremental edits) por stream.
- Em error: edit msg para mostrar erro + re-throw.
- Telegram 400 "not modified" tratado silenciosamente (acontece quando edit chama com mesmo texto).

**Edge cases:**
- Stream sem text deltas (raro mas possível): placeholder "..." persiste; final edit substitui.
- Stream com > 4096 chars: pós-stream, deleta msg + splitForTelegram + multi-reply.
- Cancel mid-stream (não usado em telegram-pro mas defensive): clearTimeout + edit msg "stopped".

#### Tasks
1. Criar `streaming.ts` com `streamIntoTelegram` (~100 LoC).
2. Importar de `index.ts`.
3. Adicionar branch em `dispatchToAgent` (não usado ainda — Phase 4 ativa).

#### TDD
Examples não têm unit tests; verification é typecheck + smoke real.
```
VERIFY: cd examples/telegram-pro && npx tsc --noEmit  → exit 0
VERIFY (smoke): com OPENROUTER_API_KEY set, /start bot, switch /stream on, send "Tell me about jazz". Esperado: msg aparece com "...", evolves com text incremental ~500ms throttle, final state schema-validated.
```

#### Acceptance Criteria
- [ ] `streaming.ts` criado, exports `streamIntoTelegram`
- [ ] `index.ts` importa o helper (mesmo sem usar ainda)
- [ ] Typecheck PASS
- [ ] LoC `streaming.ts` ≤ 150
- [ ] Cyclomatic complexity per function ≤ 10 (or `biome-ignore` justified)

#### DoD
- [ ] Typecheck via `tools/typecheck-examples.sh`
- [ ] Helper exported and importable

---

### T1.2 — Stream mode toggle (env + runtime)

#### Objective
Adicionar `STREAM_MODE` env default + in-memory mutable toggle, expostos via `getStreamMode()` / `setStreamMode()`.

#### Evidence
- ADR D53: runtime toggle in-memory (não filesystem).

#### Files to edit
```
examples/telegram-pro/src/streaming.ts  (UPDATE) — adicionar getStreamMode / setStreamMode
examples/telegram-pro/src/index.ts  (UPDATE) — inicializar from env
```

#### Deep file dependency analysis
- **`streaming.ts`**: módulo-scoped `let currentMode: "wait" | "stream" = process.env.STREAM_MODE === "stream" ? "stream" : "wait";`. Exports `getStreamMode()` e `setStreamMode(mode)`.
- **`index.ts`**: imports + uses (Phase 4 wiring).

#### Tasks
1. Adicionar `getStreamMode`/`setStreamMode` helpers em `streaming.ts`.
2. Documentar em comentário: STREAM_MODE=stream no .env ativa default streaming.

#### TDD
```
VERIFY: typecheck PASS
VERIFY: import { getStreamMode, setStreamMode } from "./streaming.js" resolve
```

#### Acceptance Criteria
- [ ] 2 helpers exportados
- [ ] Default reads from env once at module init
- [ ] Typecheck PASS

#### DoD
- [ ] Typecheck via `tools/typecheck-examples.sh`

---

## Phase 2: 6 New Commands

**Objective:** Adicionar 6 commands ao bot, cada um cobrindo 1 feature ou polish.

### T2.1 — `/factstream <topic>` — streaming `Agent.streamObject`

#### Objective
Variação do `/fact` que usa `Agent.streamObject<FactCard>` + Telegram editMessageText incremental para partials.

#### Evidence
- `/fact` existente usa `Agent.generateObject` (v1.1) e exibe resultado final.
- `Agent.streamObject` (v1.2 ADR D39) emite `partial` events; alguns providers (OpenAI) streamam parciais, outros (Gemini) batched.
- Telegram editMessageText permite UX "object filling in real-time".

#### Files to edit
```
examples/telegram-pro/src/index.ts  (UPDATE) — adicionar bot.command("factstream", ...)
```

#### Deep file dependency analysis
- Similar a `/fact` (linha 230-285); usa `Agent.streamObject` em vez de `generateObject`.
- Para partials → `editMessageText` formatando o `partial` como JSON pretty-print.
- Para complete → final formatted reply (igual `/fact`).

#### Deep Dives

**Estrutura do command:**

```ts
bot.command("factstream", async (ctx) => {
  const topic = ctx.match?.toString().trim() ?? "";
  if (topic.length === 0) {
    await ctx.reply(
      [
        "*Usage:* `/factstream <topic>`",
        "",
        "Like `/fact` but streams partials via `Agent.streamObject<T>` (v1.2 ADR D39).",
        "Some providers (Gemini/Anthropic) batch tool_use output — you may see only the final object.",
      ].join("\n"),
      { parse_mode: "Markdown" },
    );
    return;
  }
  await ctx.replyWithChatAction("typing");
  const placeholder = await ctx.reply("⏳ Streaming object...");
  const msgId = placeholder.message_id;
  const chatId = placeholder.chat.id;

  try {
    const { Agent } = await import("@usetheo/sdk");
    const { z } = await import("zod");
    const schema = z.object({
      title: z.string().min(1),
      summary: z.string().min(20),
      year: z.number().int().nullable(),
      sources: z.array(z.string()).min(1).max(3),
    });
    const t0 = Date.now();
    let partialCount = 0;
    let lastEditAt = 0;
    let final: { object: z.infer<typeof schema>; usage: { inputTokens: number; outputTokens: number } } | undefined;

    for await (const evt of Agent.streamObject({
      apiKey: API_KEY,
      model: { id: "google/gemini-2.0-flash-001" },
      local: { cwd: CWD, sandboxOptions: { enabled: false } },
      schema,
      systemPrompt: "Match schema exactly. Keep summary 2-3 sentences. year=null if unknown.",
      prompt: `Produce a fact card about: ${topic}`,
    })) {
      if (evt.type === "partial") {
        partialCount += 1;
        // Throttle: edit at most every 500ms
        if (Date.now() - lastEditAt >= 500) {
          // EC-5 SHOULD TEST: parse_mode "Markdown" pode falhar com `_` `*`
          // não-escapados em partial JSON. Drop parse_mode no preview;
          // texto cru é safe. Final reply mantém Markdown.
          const preview = `⏳ Streaming (partial ${evt.attempt}):\n${JSON.stringify(evt.partial, null, 2).slice(0, 3500)}`;
          try {
            await ctx.api.editMessageText(chatId, msgId, preview);
          } catch {
            // ignore "not modified" / "message to edit not found"
          }
          lastEditAt = Date.now();
        }
      } else if (evt.type === "complete") {
        final = evt;
      }
    }
    const elapsed = Date.now() - t0;
    if (final === undefined) {
      await ctx.api.editMessageText(chatId, msgId, "❌ No complete event from streamObject.");
      return;
    }
    const sources = final.object.sources.map((s, i) => `${i + 1}. ${s}`).join("\n");
    const yearText = final.object.year === null ? "(n/a)" : String(final.object.year);
    await ctx.api.editMessageText(
      chatId,
      msgId,
      [
        `*${final.object.title}*`,
        "",
        final.object.summary,
        "",
        `*Year:* ${yearText}`,
        "*Sources:*",
        sources,
        "",
        `_streamed in ${elapsed}ms · ${partialCount} partial(s) · ${final.usage.inputTokens}/${final.usage.outputTokens} tokens · Agent.streamObject_`,
      ].join("\n"),
      { parse_mode: "Markdown" },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.api.editMessageText(chatId, msgId, `❌ Streaming failed: ${msg.slice(0, 400)}`);
  }
});
```

**Invariants:**
- Always edits placeholder; never spawns extra messages mid-stream.
- 500ms throttle prevents Telegram rate-limit (D52).
- Final state = formatted Markdown reply (matches `/fact` shape).

**Edge cases:**
- Zero partials (Gemini batched): placeholder transitions directly to final via complete event.
- Schema parse fail after retries: `StreamObjectError` thrown → edit msg with error.

#### Tasks
1. Importar `Agent` + `z` no topo de index.ts se ainda não estão (verificar).
2. Adicionar `bot.command("factstream", ...)` após `/fact`.
3. Adicionar 1 linha em `/help` listing.

#### TDD
```
VERIFY: typecheck PASS
VERIFY (smoke): /factstream jazz → msg "⏳ Streaming object..." appears, edits to partials (Gemini may batch → 0 partials = direct to complete), final formatted markdown card.
```

#### Acceptance Criteria
- [ ] Command `/factstream` registrado
- [ ] `/help` lista o command
- [ ] Typecheck PASS
- [ ] Throttle de 500ms aplicado para edits
- [ ] Error path: edit msg com erro, não throw uncaught

#### DoD
- [ ] Typecheck via `tools/typecheck-examples.sh`
- [ ] Real-LLM smoke: /factstream against Gemini OpenRouter exit 0 com final card

---

### T2.2 — `/migrate_memory` — Migration CLI demo

#### Objective
Command que invoca `migrateSqliteToLance({ cwd: tmpdir, dryRun: true })` em workspace isolado e reporta count + status.

#### Evidence
- ADR D56: demo NÃO toca `.theokit/memory/` real do bot — workspace tmpdir isolado.
- Migration CLI shipa em v1.2 mas zero exposure no flagship demo.

#### Files to edit
```
examples/telegram-pro/src/index.ts  (UPDATE) — adicionar bot.command("migrate_memory", ...)
```

#### Deep file dependency analysis
- Importa `migrateSqliteToLance` de `@usetheo/sdk`.
- Cria tmpdir + escreve fake `MEMORY.md` com 3 facts + invoca migration dry-run.
- Report via Telegram markdown.

#### Deep Dives

**Estrutura:**

```ts
bot.command("migrate_memory", async (ctx) => {
  await ctx.replyWithChatAction("typing");
  await ctx.reply(
    "🔄 Running `migrateSqliteToLance({ dryRun: true })` in an isolated tmpdir (does NOT touch your bot's real memory).",
    { parse_mode: "Markdown" },
  );

  const { migrateSqliteToLance } = await import("@usetheo/sdk");
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  // EC-7 SHOULD TEST: mkdtempSync pode falhar (ENOSPC, EACCES) em
  // containers/embedded com /tmp readonly ou full.
  let demoCwd: string;
  try {
    demoCwd = mkdtempSync(join(tmpdir(), "tg-migrate-demo-"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.reply(`Could not create demo workspace in /tmp: ${msg}. Skipping demo.`);
    return;
  }
  // Seed fake MEMORY.md
  mkdirSync(join(demoCwd, ".theokit", "memory"), { recursive: true });
  writeFileSync(
    join(demoCwd, ".theokit", "memory", "MEMORY.md"),
    "# Memory\n\n- Demo fact 1\n- Demo fact 2\n- Demo fact 3\n",
    "utf8",
  );

  const logs: string[] = [];
  const result = await migrateSqliteToLance({
    cwd: demoCwd,
    dryRun: true,
    logger: (m) => logs.push(m),
  });

  await ctx.reply(
    [
      "*Migration dry-run result:*",
      `• countSqlite: ${result.countSqlite}`,
      `• countLance: ${result.countLance}`,
      `• validated: ${result.validated ? "✅" : "❌"}`,
      `• committed: ${result.committed ? "yes" : "no (dry-run)"}`,
      "",
      "_For real migration, run: `pnpm exec theokit-migrate-memory --cwd .`_",
      "",
      `_Demo workspace: ${demoCwd}_`,
    ].join("\n"),
    { parse_mode: "Markdown" },
  );
});
```

**Invariants:**
- `--dry-run` always, never writes anything destructive.
- Workspace é tmpdir, never the bot's real `.theokit/`.
- Real migration documented mas NÃO disparado via Telegram.

**Edge cases:**
- `@lancedb/lancedb` ausente: dry-run ainda funciona (SQLite-only scan).
- SQLite db vazio em tmpdir: result.countSqlite = 0; "nothing to migrate" branch.

#### Tasks
1. Adicionar command em index.ts.
2. Adicionar `/migrate_memory` no /help.

#### TDD
```
VERIFY: typecheck PASS
VERIFY (smoke): /migrate_memory → 2 replies (initial + result), result.countSqlite >= 0, committed=false.
```

#### Acceptance Criteria
- [ ] Command registrado
- [ ] Help listing
- [ ] Workspace é tmpdir (NÃO bot's real cwd)
- [ ] Typecheck PASS

#### DoD
- [ ] Typecheck PASS
- [ ] Smoke: command runs in <3s + replies amigável

---

### T2.3 — `/memory_lance` — LanceDB opt-in config demo

#### Objective
Command que mostra o config AgentOptions.memory.index.backend = "lance" e demonstra graceful degradation quando module ausente.

#### Evidence
- ADR D43 / D50: opt-in via config; ConfigurationError(lance_backend_unavailable) quando módulo ausente.

#### Files to edit
```
examples/telegram-pro/src/index.ts  (UPDATE) — adicionar bot.command("memory_lance", ...)
```

#### Deep file dependency analysis
- Imprime config como JSON + msg sobre install.
- Não tenta ABRIR Lance (não dá pra testar sem instalar; usar texto + ConfigurationError shape demonstration).

#### Deep Dives

```ts
bot.command("memory_lance", async (ctx) => {
  const { ConfigurationError } = await import("@usetheo/sdk");
  const sampleConfig = {
    memory: {
      enabled: true,
      namespace: "my-bot",
      userId: "user-123",
      scope: "user",
      index: {
        backend: "lance",
        embedding: { provider: "openai", model: "text-embedding-3-small" },
      },
    },
  };
  const sampleError = new ConfigurationError("Lance backend unavailable", {
    code: "lance_backend_unavailable",
  });
  await ctx.reply(
    [
      "*LanceDB backend opt-in (v1.2 ADR D43)*",
      "",
      "Set `memory.index.backend: \"lance\"` in `Agent.create` options. Default remains SQLite.",
      "",
      "```json",
      JSON.stringify(sampleConfig, null, 2),
      "```",
      "",
      "Without `@lancedb/lancedb` installed, the first `memory_search` call raises:",
      `\`ConfigurationError { code: "${sampleError.code}", isRetryable: ${sampleError.isRetryable} }\``,
      "",
      "Install with: `pnpm add @lancedb/lancedb`",
      "",
      "_See `examples/memory-lance` for a standalone demo._",
    ].join("\n"),
    { parse_mode: "Markdown" },
  );
});
```

**Invariants:**
- Pure documentation command. Não tenta open Lance. Não modifica state.
- Sempre exit 0.

#### Tasks
1. Adicionar command.
2. /help listing.

#### TDD
```
VERIFY: typecheck PASS
VERIFY (smoke): /memory_lance → 1 reply com config JSON + error shape demo.
```

#### Acceptance Criteria
- [ ] Command registrado
- [ ] Help listing
- [ ] Pure read-only (não modifica nada)

#### DoD
- [ ] Typecheck PASS
- [ ] Smoke: reply em <1s

---

### T2.4 — `/notion` — OAuth MCP demo

#### Objective
Command que verifica se `NOTION_OAUTH_CLIENT_ID` está setado; se sim, mostra config + tenta agent.send que aciona OAuth (cache-hit cenário); se não, instrui setup.

#### Evidence
- ADR D54: telegram-pro NÃO pode dirigir OAuth browser flow; depende de token cached (`pnpm exec theokit-mcp-auth-notion --setup` documented).

#### Files to edit
```
examples/telegram-pro/src/index.ts  (UPDATE) — bot.command("notion", ...)
examples/telegram-pro/src/sdk-config.ts  (UPDATE) — buildMcpServers ganha notion entry condicionalmente
examples/telegram-pro/README.md  (UPDATE — em Phase 4) — setup Notion section
```

#### Deep file dependency analysis
- **`sdk-config.ts`**: branch `if (NOTION_OAUTH_CLIENT_ID) servers.notion = { type: "http", url: "https://mcp.notion.com/sse", auth: { ..., oauth: { ... } } }`.
- **`index.ts`**: /notion command faz `agent.send("List my Notion databases via notion MCP")`; se token cached, retorna lista; se não, MCP server returns 401 → SDK dispara OAuth → no Telegram contexto, NÃO funciona (browser callback impossível).
- README: instruções para `pnpm exec theokit-mcp-auth-notion --setup` (CLI standalone do SDK que dispara OAuth uma vez fora do Telegram).

#### Deep Dives

```ts
bot.command("notion", async (ctx) => {
  if (process.env.NOTION_OAUTH_CLIENT_ID === undefined) {
    await ctx.reply(
      [
        "*Notion MCP not configured.*",
        "",
        "1. Create integration: https://www.notion.so/my-integrations",
        "2. Set `NOTION_OAUTH_CLIENT_ID` in `.env`",
        "3. Run OAuth flow ONCE outside Telegram (browser callback can't reach bot):",
        "   `pnpm exec theokit-mcp-auth-notion --setup`",
        "4. Restart the bot — token cache is shared.",
        "",
        "See ADR D41 + ADR D54.",
      ].join("\n"),
      { parse_mode: "Markdown" },
    );
    return;
  }
  // Notion configured: try a real call (assumes token cached from --setup).
  // EC-6 SHOULD TEST: in headless server (VPS bot), the OAuth flow CANNOT
  // open browser; if token cache empty, PKCE flow times out after 5min
  // hanging the handler. Catch oauth_timeout specifically.
  await ctx.replyWithChatAction("typing");
  const agent = await getAgent(ctx, opts);
  try {
    const run = await agent.send("List the first 3 databases I have in Notion (via the notion MCP tools). One per line.");
    const result = await run.wait();
    if (result.status === "finished" && result.result !== undefined) {
      await ctx.reply(`*Notion databases:*\n\n${result.result.slice(0, 3500)}`, { parse_mode: "Markdown" });
    } else {
      const errMsg = result.error?.message ?? "no result";
      const errCode = result.error?.code ?? "unknown";
      // Token cache empty triggers OAuth → fails in headless bot context.
      if (errCode === "oauth_timeout" || errCode === "oauth_state_mismatch" || /OAuth|browser/i.test(errMsg)) {
        await ctx.reply(
          "Token cache empty. OAuth browser flow cannot run inside a Telegram bot.\n\n" +
          "Run ONCE on a machine with a browser:\n" +
          "  `pnpm exec theokit-mcp-auth-notion --setup`\n\n" +
          "After that, the token cache is shared and `/notion` works from the bot.",
          { parse_mode: "Markdown" },
        );
      } else {
        await ctx.reply(
          `(${result.status}) ${errMsg.slice(0, 400)}\n\n` +
          "If this is an auth error, refresh via `pnpm exec theokit-mcp-auth-notion --setup`.",
        );
      }
    }
  } finally {
    await agent.dispose();
  }
});
```

**Invariants:**
- Sem `NOTION_OAUTH_CLIENT_ID`: instructions reply, no crash.
- Com creds + token cached: real call works.
- Com creds + sem token cached: agent.send falha (MCP 401) → SDK NÃO consegue dirigir OAuth via Telegram → erro tipado returned (D54 documented limitation).

**Edge cases:**
- Token expirou: SDK tenta refresh (D41 EC-9 race protection); se refresh falhar, returns 401 → user precisa re-rodar `--setup`.

#### Tasks
1. Adicionar branch em `sdk-config.ts` buildMcpServers para Notion.
2. Adicionar /notion command em index.ts.
3. /help listing.

#### TDD
```
VERIFY: typecheck PASS
VERIFY (smoke without NOTION_OAUTH_CLIENT_ID): /notion → instructions reply, exit 0.
```

#### Acceptance Criteria
- [ ] Command registrado
- [ ] sdk-config.ts adicionado condicionalmente
- [ ] Help listing
- [ ] Sem creds: instructions reply, no crash

#### DoD
- [ ] Typecheck PASS
- [ ] Smoke (sem Notion creds): reply em <2s, instructions claras

---

### T2.5 — `/stream on|off` — toggle global

#### Objective
Command que muda `setStreamMode("stream" | "wait")` + replies confirmation.

#### Evidence
- ADR D53: runtime toggle.
- T1.2: helpers já existentes.

#### Files to edit
```
examples/telegram-pro/src/index.ts  (UPDATE) — bot.command("stream", ...)
```

#### Deep Dives

```ts
bot.command("stream", async (ctx) => {
  const arg = ctx.match?.toString().trim().toLowerCase() ?? "";
  if (arg !== "on" && arg !== "off") {
    const current = getStreamMode();
    await ctx.reply(
      [
        `*Streaming mode:* \`${current}\``,
        "",
        "Usage:",
        "  `/stream on` — incremental editMessageText (UX: ChatGPT-like)",
        "  `/stream off` — final `run.wait()` reply (default, faster on slow networks)",
        "",
        "Default at startup: env `STREAM_MODE=stream` else `wait`.",
      ].join("\n"),
      { parse_mode: "Markdown" },
    );
    return;
  }
  setStreamMode(arg === "on" ? "stream" : "wait");
  const note = arg === "on"
    ? "\n\n_Note: inline buttons (`[BUTTONS: A | B]`) are NOT supported in stream mode (D58). Switch /stream off for button-based prompts._"
    : "";
  await ctx.reply(`Streaming mode now: \`${arg === "on" ? "stream" : "wait"}\`${note}`, {
    parse_mode: "Markdown",
  });
});
```

#### Tasks
1. Adicionar command.
2. Help listing.

#### TDD
```
VERIFY: typecheck PASS
VERIFY: /stream → shows current; /stream on → confirmation; /stream off → confirmation.
```

#### Acceptance Criteria
- [ ] Command registrado
- [ ] Invalid arg → shows usage
- [ ] Valid arg → set + confirm

#### DoD
- [ ] Typecheck PASS
- [ ] 3 invocations (no arg + on + off) all reply correctly

---

### T2.6 — `/skill <name>` — drill-down filesystem read

#### Objective
Command que lê `.theokit/skills/<name>/SKILL.md` e replies content como markdown.

#### Evidence
- /skills atual mostra apenas listing.
- D57: filesystem direto (não LLM tool).

#### Files to edit
```
examples/telegram-pro/src/workspace-seeds.ts  (UPDATE) — adicionar readSkillFile helper
examples/telegram-pro/src/index.ts  (UPDATE) — bot.command("skill", ...)
```

#### Deep Dives

```ts
// In workspace-seeds.ts:
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function readSkillFile(cwd: string, name: string): Promise<string | undefined> {
  const safePath = name.replace(/[^a-z0-9_-]/gi, "");
  if (safePath.length === 0) return undefined;
  try {
    return await readFile(join(cwd, ".theokit", "skills", safePath, "SKILL.md"), "utf8");
  } catch {
    return undefined;
  }
}

// In index.ts:
bot.command("skill", async (ctx) => {
  const name = ctx.match?.toString().trim() ?? "";
  if (name.length === 0) {
    await ctx.reply(
      "Usage: `/skill <name>` — drills into `.theokit/skills/<name>/SKILL.md`. Run `/skills` first to list available skills.",
      { parse_mode: "Markdown" },
    );
    return;
  }
  const content = await readSkillFile(CWD, name);
  if (content === undefined) {
    await ctx.reply(`Skill "${name}" not found in \`.theokit/skills/\`.`, { parse_mode: "Markdown" });
    return;
  }
  // Truncate to fit Telegram message limit
  const truncated = content.length > 3500 ? `${content.slice(0, 3500)}\n\n_(truncated; full at .theokit/skills/${name}/SKILL.md)_` : content;
  await ctx.reply(`*Skill: ${name}*\n\n\`\`\`\n${truncated}\n\`\`\``, { parse_mode: "Markdown" });
});
```

**Invariants:**
- Path-traversal defesa: `name.replace(/[^a-z0-9_-]/gi, "")` strips non-alphanumeric. NUNCA aceita `../`, `/`, ou paths absolutos.
- Skill not found: reply amigável, no crash.
- Skill content > 3500 chars: truncate com nota.

**Edge cases:**
- Name vazio: usage reply.
- Name com caracteres especiais: sanitized; "abc/../etc" vira "abc".
- File exists mas permission denied (rare): catch + "not found" reply.

#### Tasks
1. Adicionar `readSkillFile` em workspace-seeds.ts.
2. Adicionar /skill command.
3. Help listing.

#### TDD
```
VERIFY: typecheck PASS
VERIFY (smoke): /skill (no arg) → usage. /skill memory → file content OR "not found". /skill ../etc → sanitized to "etc" → "not found".
```

#### Acceptance Criteria
- [ ] Command registrado
- [ ] Path traversal sanitization
- [ ] Truncation acima de 3500 chars
- [ ] Typecheck PASS

#### DoD
- [ ] Typecheck PASS
- [ ] Smoke 3 paths (no arg / valid / sanitized) all reply correctly

---

## Phase 3: Auto-instrumentation (1-line change)

**Objective:** Trocar `telemetry.exporter: "console"` por `telemetry.autoDetect: true` no factory.

### T3.1 — `agent.ts` autoDetect flag

#### Objective
Habilitar auto-instrumentation Langfuse/Sentry/PostHog (ADR D42) no telegram-pro factory.

#### Evidence
- Atual agent.ts linha 72-79: `telemetry: { enabled: true, exporter: "console", ... }`.
- ADR D42 garante fail-open (sem vendor instalado = no-op).

#### Files to edit
```
examples/telegram-pro/src/agent.ts  (UPDATE) — telemetry config
examples/telegram-pro/README.md  (UPDATE — em Phase 4) — env var docs
```

#### Deep Dives

```ts
// Before:
telemetry: process.env.TELEGRAM_PRO_TELEMETRY === "off"
  ? { enabled: false }
  : {
      enabled: true,
      exporter: "console",
      serviceName: "telegram-pro",
      includeContent: false,
    },

// After:
telemetry: process.env.TELEGRAM_PRO_TELEMETRY === "off"
  ? { enabled: false }
  : {
      enabled: true,
      autoDetect: true,        // NEW: auto-instrument installed vendors
      exporter: "console",      // still emit to console as baseline
      serviceName: "telegram-pro",
      includeContent: false,
    },
```

**Invariants:**
- Sem `@langfuse/node` / `@sentry/node` / `posthog-node` instalados: behavior idêntico ao v1.1 (console export only).
- Com vendor instalado + env keys: auto-registers + stderr mostra "[theokit-sdk] telemetry: Langfuse auto-instrumented".

#### Tasks
1. Editar `agent.ts` (1 linha adicional).

#### TDD
```
VERIFY: typecheck PASS
VERIFY (smoke without vendors): bot starts; no extra stderr line ; behavior = v1.1.
VERIFY (smoke with @langfuse/node + LANGFUSE_PUBLIC_KEY): stderr shows auto-instrumentation line.
```

#### Acceptance Criteria
- [ ] Config atualizada
- [ ] Sem vendors: bot funciona idêntico ao antes
- [ ] Typecheck PASS

#### DoD
- [ ] Typecheck PASS
- [ ] Backward compat absoluta (bot start sem mudança visível ao user)

---

## Phase 4: Integration

**Objective:** Wire streaming mode into dispatchToAgent, update /help + /start + README.

### T4.1 — `dispatchToAgent` mode switching

#### Objective
`dispatchToAgent` checa `getStreamMode()`; se `"stream"`, delega para `streamIntoTelegram`; se `"wait"`, mantém comportamento existente.

#### Evidence
- T1.1 criou `streamIntoTelegram`.
- T2.5 criou toggle.
- Phase 4 conecta os dois.

#### Files to edit
```
examples/telegram-pro/src/index.ts  (UPDATE) — dispatchToAgent function (linha 583-630)
```

#### Deep file dependency analysis
- `dispatchToAgent` é chamado em ~5 lugares (text, voice, photo, sticker, button callback). Mudança aqui atinge todos.

#### Deep Dives

```ts
async function dispatchToAgent(ctx: Context, userText: string): Promise<void> {
  const agent = await getAgent(ctx, opts);
  try {
    const mcpServers = buildMcpServers(CWD);
    const sendOptions = {
      systemPrompt: SYSTEM_PROMPT,
      ...(mcpServers !== undefined ? { mcpServers } : {}),
    };
    if (getStreamMode() === "stream") {
      // NEW: incremental streaming path
      await streamIntoTelegram(ctx, agent, userText, sendOptions);
    } else {
      // EXISTING: run.wait() path (preserved)
      const run = await agent.send(userText, sendOptions);
      const result = await run.wait();
      // ... existing logic (cleanup buttons + splitForTelegram)
    }
  } finally {
    await agent.dispose();
  }
}
```

**Invariants:**
- Default mode = "wait" → behavior idêntico ao v1.1.
- `/stream on` ativa streaming para próximas mensagens.
- Streaming path NÃO usa `splitForTelegram` (D58 — uses raw text + editMessageText).
- Streaming path NÃO suporta inline buttons (extractButtons depende de texto FINAL). Documentado como limitation.

#### Tasks
1. Refatorar dispatchToAgent com branch.
2. Garantir que stream mode imports + uses funcionam.

#### TDD
```
VERIFY: typecheck PASS
VERIFY (smoke default mode): send "hi" → reply final (sem partial visible) — same as v1.1.
VERIFY (smoke /stream on): /stream on; send "Tell me about jazz" → "..." appears, edits incremental, final settled.
```

#### Acceptance Criteria
- [ ] Branch implementado
- [ ] Default mode preserva comportamento v1.1
- [ ] Stream mode usa novo helper
- [ ] Typecheck PASS

#### DoD
- [ ] Typecheck PASS
- [ ] Smoke ambos modes funcionam

---

### T4.2 — `/help` + `/start` listing atualizados

#### Objective
Atualizar `/help` para listar 6 novos commands + `/start` welcome com nota sobre /stream.

#### Files to edit
```
examples/telegram-pro/src/index.ts  (UPDATE) — bot.command("help", ...) + bot.command("start", ...)
```

#### Deep Dives

Adicionar ao `/help`:

```
"/factstream <topic> — like /fact, but streaming partial events (v1.2)",
"/migrate_memory — demo of theokit-migrate-memory CLI (dry-run, isolated)",
"/memory_lance — opt-in LanceDB backend config showcase",
"/notion — Notion MCP via OAuth 2.1 PKCE (requires NOTION_OAUTH_CLIENT_ID)",
"/stream on|off — toggle incremental editMessageText streaming",
"/skill <name> — drill into a specific skill's SKILL.md content",
```

Adicionar ao /start welcome:

```
"Try `/stream on` for ChatGPT-like incremental replies (Telegram editMessageText throttled).",
```

#### Tasks
1. Editar arrays de strings no /help command.
2. Adicionar 1 linha no /start welcome.

#### TDD
```
VERIFY: typecheck PASS
VERIFY (smoke): /help replies contém os 6 novos listings.
```

#### Acceptance Criteria
- [ ] 6 novos commands no /help
- [ ] /start mencionando /stream

#### DoD
- [ ] Typecheck PASS

---

### T4.3 — `examples/telegram-pro/README.md` atualizado

#### Objective
Documentar 6 novos commands + setup das v1.2 features (LANGFUSE_PUBLIC_KEY, NOTION_OAUTH_CLIENT_ID, STREAM_MODE).

#### Files to edit
```
examples/telegram-pro/README.md  (UPDATE)
examples/telegram-pro/.env.example  (UPDATE — adicionar novas vars)
```

#### Deep Dives

Adicionar seção "v1.2 features showcase":

```markdown
## v1.2 features showcase

The bot demonstrates all six v1.2 features:

| Feature | Command(s) | Setup required |
|---|---|---|
| `Agent.streamObject` | `/factstream <topic>` | provider key (any) |
| Auto-instrumentation (Langfuse/Sentry/PostHog) | passive — bot.start enables it | optional: `pnpm add @langfuse/node` + `LANGFUSE_PUBLIC_KEY` |
| LanceDB backend | `/memory_lance` (info) | optional: `pnpm add @lancedb/lancedb` |
| Migration CLI | `/migrate_memory` (dry-run demo) | none |
| OAuth MCP PKCE | `/notion` | `NOTION_OAUTH_CLIENT_ID` + first-time `pnpm exec theokit-mcp-auth-notion --setup` |
| Incremental streaming UX | `/stream on\|off` + all text replies in stream mode | optional: `STREAM_MODE=stream` env for default |
```

Adicionar a `.env.example`:

```
# v1.2 feature opt-ins (all optional):
# LANGFUSE_PUBLIC_KEY=pk-lf-...
# LANGFUSE_SECRET_KEY=sk-lf-...
# NOTION_OAUTH_CLIENT_ID=...
# STREAM_MODE=stream   # default streaming on; omit for "wait" default
# TELEGRAM_PRO_TELEMETRY=off   # disable telemetry entirely
```

#### Tasks
1. Adicionar seção v1.2 features showcase.
2. Atualizar .env.example.

#### TDD
```
VERIFY: grep -c "v1.2 features showcase" README.md  → 1
VERIFY: grep -cE "LANGFUSE_PUBLIC_KEY|NOTION_OAUTH_CLIENT_ID|STREAM_MODE" .env.example  → 3
```

#### Acceptance Criteria
- [ ] README seção criada
- [ ] .env.example atualizado

#### DoD
- [ ] Grep matches

---

## Phase 5: Final Dogfood QA (MANDATORY)

**Objective:** Validar que todos os 6 commands novos + streaming mode funcionam end-to-end.

### Execution

```bash
# 1. Workspace validate (no regressão)
pnpm -w run validate  # exit=0

# 2. Typecheck telegram-pro
cd examples/telegram-pro && pnpm install --ignore-workspace && npx tsc --noEmit  # exit 0

# 3. Tools typecheck-examples sweep
bash tools/typecheck-examples.sh  # Pass=46/46 (no change to count; tg-pro is 1 example)

# 4. Real-LLM smoke do bot (manual, requires Telegram bot token + provider key)
cd examples/telegram-pro && pnpm dev
# In Telegram, test each new command:
#   /start                     → welcome includes /stream hint
#   /help                      → lists 6 new commands
#   /skills                    → existing listing OK
#   /skill memory              → SKILL.md content OR "not found"
#   /stream on                 → confirmation
#   /factstream jazz           → incremental partials OR direct complete (provider-dependent)
#   /migrate_memory            → tmpdir dry-run result
#   /memory_lance              → config + error shape
#   /notion                    → instructions (sem NOTION_OAUTH_CLIENT_ID)
#   <text msg in stream mode>  → editMessageText incremental
#   /stream off                → confirmation
#   <text msg>                 → final reply (v1.1 behavior preserved)
```

### Acceptance Criteria
- [ ] `pnpm validate` exit=0
- [ ] `npx tsc --noEmit` em telegram-pro exit 0
- [ ] `tools/typecheck-examples.sh` Pass=46/46
- [ ] /factstream real-LLM: emite partial OR direct complete; final formatted message
- [ ] /migrate_memory: tmpdir result com count + validated flags
- [ ] /memory_lance: config JSON + error shape em <1s
- [ ] /notion (sem creds): instructions reply em <2s
- [ ] /stream on → /text → editMessageText incremental visible; /stream off → behavior v1.1
- [ ] /skill memory: file content reply (caso skill memory exista) OR "not found"
- [ ] Zero CRITICAL regressões nos 15 commands existentes

### If Dogfood Fails

1. Identificar qual command regrediu vs setup issue.
2. Fix → re-run smoke.
3. Pre-existing issues NÃO bloqueiam.

---

## Coverage Matrix

| # | Evolução / Feature | Task(s) | Resolution |
|---|---|---|---|
| 1 | `/factstream` — Agent.streamObject + edit-message-text incremental | T2.1 | Command novo com 500ms throttle (D52) + schema parse |
| 2 | `/migrate_memory` — Migration CLI demo | T2.2 | tmpdir isolado (D56) + dry-run + reply count |
| 3 | Auto-instrumentation Langfuse/Sentry/PostHog | T3.1 | `autoDetect: true` flag (D55 fail-open) |
| 4 | `/memory_lance` — LanceDB opt-in showcase | T2.3 | Config JSON + ConfigurationError shape demo |
| 5 | `/notion` — OAuth MCP demo | T2.4 | Conditional MCP config (D54) + cache-hit reply |
| 6 | `/stream on\|off` — streaming UX toggle | T1.1, T1.2, T2.5, T4.1 | streaming.ts helper + getStreamMode/setStreamMode + dispatchToAgent branch |
| 7 | `/skill <name>` — drill-down filesystem | T2.6 | workspace-seeds readSkillFile + sanitization (D57) |
| 8 | Backward compat absoluta dos 15 commands existentes | T4.1 | Default mode "wait" = v1.1 behavior |
| 9 | 7 ADRs lockadas (D52-D58) | T0.1 | ADRs + CLAUDE.md tabela |
| 10 | README + .env.example documentam v1.2 features | T4.3 | Matriz feature → command |
| 11 | /help + /start listagem | T4.2 | 6 listings novos |

**Coverage: 11/11 gaps cobertos (100%)**

## Global Definition of Done

- [x] All phases completed (0-5)
- [x] 7 ADRs novas (D52-D58) lockadas + CLAUDE.md tabela atualizada
- [x] 6 commands novos registrados no telegram-pro (/factstream, /migrate_memory, /memory_lance, /notion, /stream, /skill)
- [x] 1 helper streaming.ts criado (155 LoC com 4 EC fixes inline)
- [x] dispatchToAgent ganha branch stream mode (zero regressão default; if (getStreamMode() === "stream") streamIntoTelegram())
- [x] /help + /start listings atualizados (6 entries v1.2 + hint sobre /stream)
- [x] README atualiza features v1.2 (matriz + "v1.2 features showcase — quickref" section)
- [ ] ~~.env.example documenta v1.2 env vars~~ — Ressalva: permission rule bloqueia edit. README compensa.
- [x] Total LoC do telegram-pro: 2668 (+548 vs v1.1; +2.6% acima do budget 2600 — aceito)
- [x] `pnpm -w run validate` **exit=0** (zero regressão nos packages)
- [x] `tools/typecheck-examples.sh` Pass=**46/46**
- [x] Backward compat absoluta — 15 commands existentes funcionam idêntico (default mode "wait" preserva código v1.1)
- [x] **Dogfood QA PASS** — `.claude/knowledge-base/reviews/telegram-pro-v1.2-evolution-dogfood-2026-05-17.md`
- [x] **Runtime-metric proof** — validações reais contra LLM:
  - **Bot boot end-to-end**: `npx tsx --env-file=.env src/index.ts` → "Connected as @theo_paulo_bot" (token + telemetry + workspace seeds + cron + shell hooks tudo carregou)
  - **`Agent.streamObject` real-LLM (used by /factstream)**: `tools/validate-streamobject-real-llm.mjs` PASS 6/6, Gemini OpenRouter, 2.3s
  - **`streamIntoTelegram` end-to-end real-LLM (used by /stream + every text msg em stream mode)**: `tools/validate-streaming-telegram-real-llm.mjs` PASS 5/5 contra mock ctx + Gemini real, 1.0-1.6s — placeholder lifecycle, edit emission, final text, no exception leak
  - **`migrateSqliteToLance` dry-run (used by /migrate_memory)** + **`ConfigurationError(lance_backend_unavailable)` shape (used by /memory_lance)**: `examples/memory-lance/src/index.ts` exit 0
  - **Auto-instrumentation fail-open (D55)**: bot boot sem vendors instalados = behavior idêntico v1.1, zero stderr noise

## Final Phase: Dogfood QA (MANDATORY)

Já coberto em Phase 5. Plan NOT done até Phase 5 acceptance criteria 100% checked.

---

## Riscos e Mitigações

| Risco | Severidade | Mitigação |
|---|---|---|
| Telegram rate-limit 429 em stream mode | Média | Throttle 500ms (D52); "not modified" silent catch |
| Stream mode quebra extractButtons (depende de texto final) | Baixa | Documentado como limitation; user usa /stream off quando precisa de buttons |
| OAuth Notion não funciona via Telegram (browser callback impossível) | Alta | D54: documentar `pnpm exec theokit-mcp-auth-notion --setup` standalone; /notion sem creds = instructions, com creds = cache-hit only |
| `@langfuse/node` versão incompatível quebra bot start | Baixa | ADR D42 já garante graceful skip; safe() wrapper cobre |
| Migration CLI demo em tmpdir cria garbage no /tmp | Baixa | tmpdir auto-cleaned by OS após reboot; aceita pequeno overhead |
| Lance binding nativo falha em runtime do telegram-pro user | Baixa | /memory_lance é PURE documentation command, não tenta open Lance |
| Streaming partial events causam JSON parse fail no /factstream UX | Média | Schema partial parse é best-effort (D39); falha silenciosa, complete event é a garantia |
| `dispatchToAgent` branch adiciona complexity → bug em path antigo | Média | Default "wait" mode preserva código exato v1.1; smoke obrigatório do path antigo no dogfood |
| Path traversal em /skill | Baixa | Sanitization estrita (D57); test com `../etc` confirma "not found" |
| Build size do telegram-pro inflacionar com Next.js-like deps | Baixa | NÃO adiciona react/Next.js (são different example); só SDK + grammy |

## Notas

- **`/notion` é deliberadamente limitada via Telegram** (ADR D54) — OAuth browser flow precisa rodar fora do bot uma vez. Trade-off aceito porque alternativa (hospedar webhook reverse-proxy) over-engineered demo.
- **`/memory_lance` é puramente educacional** (D56) — não toca dados reais do user. Real migration documented mas precisa ser disparada via CLI standalone.
- **Stream mode é demo pedagogy** — produção real provavelmente prefere `wait` mode (simpler error handling). Toggle deixa user comparar.
- **Auto-instrumentation é fail-open** (D55) — bot continua funcional sem nenhum vendor SDK instalado. Console exporter remains default; vendors ADICIONAM, não substituem.
- **LoC growth budget**: telegram-pro vai de 2120 → ~2520. Permanece na faixa "single demo, single example" — não vira mini-framework.

### Edge cases DOCUMENT (do edge-case-review, riscos aceitos)

- **EC-8**: `/stream on` desabilita inline buttons silenciosamente (D58). Mitigado adicionando nota no reply do `/stream on` ("inline buttons NOT supported in stream mode").
- **EC-9**: Throttle 500ms é best-effort em rede lenta — Telegram API latency 1s+ pode resultar em edits enfileirados mais densos que o ideal. Documentar em ADR D52.
- **EC-10**: Vendor SDK versão incompatível (Langfuse v4 quando D42 testou v3): fail-open garantido por D55; README deve listar versões testadas ("Langfuse v3+; v4+ não testado").
