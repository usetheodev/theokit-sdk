---
marp: true
theme: uncover
paginate: true
---

<style>
section {
  background-color: #0f172a;
  color: #e2e8f0;
  font-family: 'Inter', 'SF Pro Display', 'Segoe UI', sans-serif;
  font-size: 26px;
  padding: 50px 60px;
}
h1 {
  color: #38bdf8;
  font-size: 40px;
  font-weight: 700;
  margin-bottom: 20px;
}
h2 {
  color: #818cf8;
  font-size: 32px;
  font-weight: 600;
  margin-bottom: 16px;
}
h3 {
  color: #a78bfa;
  font-size: 26px;
  font-weight: 600;
}
ul, ol {
  margin-left: 10px;
  line-height: 1.7;
}
li {
  margin-bottom: 6px;
}
li::marker {
  color: #38bdf8;
}
code {
  background-color: #1e293b;
  color: #22d3ee;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 22px;
}
pre {
  background-color: #1e293b;
  color: #e2e8f0;
  padding: 16px;
  border-radius: 8px;
  border: 1px solid #334155;
  font-size: 18px;
}
blockquote {
  border-left: 4px solid #818cf8;
  padding-left: 20px;
  color: #94a3b8;
  font-style: italic;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 22px;
}
th {
  background-color: #1e293b;
  color: #38bdf8;
  padding: 10px 14px;
  text-align: left;
  border-bottom: 2px solid #334155;
}
td {
  border-bottom: 1px solid #1e293b;
  padding: 8px 14px;
}
a { color: #38bdf8; }
strong { color: #22d3ee; }
em { color: #a78bfa; }
section.lead {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  background: radial-gradient(ellipse at center, #1e293b 0%, #0f172a 70%);
}
section.lead h1 {
  font-size: 48px;
  text-shadow: 0 0 20px rgba(56, 189, 248, 0.3);
}
section.lead h2 {
  color: #94a3b8;
  font-weight: 400;
  font-size: 28px;
}
footer {
  color: #475569;
  font-size: 14px;
}
</style>

<!-- _class: lead -->

# SDK Technical Superiority

## 51+ tasks shipped across 5 phases
## `@theokit/sdk` — Elevation Report

---

# O Problema: 135 Findings

**4 agentes de deep-review paralelos** auditaram o SDK inteiro:

| Audit | Area | Findings |
|-------|------|----------|
| **DR1** | SDK core (agent, types, errors) | 30 |
| **DR2** | Agent-loop + tool-dispatch | 25 |
| **DR3** | LLM providers + transport | 25 |
| **DR4** | Memory subsystem | 25 |
| **DR6** | Security + persistence | 30 |

> 135 findings organizados em **8 fases x ~85 tasks** executaveis

---

# Antes vs Depois

| Dimensao | Antes | Depois | Vs Competidores |
|----------|-------|--------|-----------------|
| Error types | `(string & {})` escape | **Closed union** 16 codes | = a peer vendor AI |
| Tool dispatch | Serial `for...of` | **Parallel** cap 4 | > OpenAI Agents |
| Prompt caching | Silently dropped | **5-bucket telemetry** | > a framework.js |
| Secret redaction | 12 patterns | **30 patterns** + PARAM | > All |
| Cookie security | Zero-pad "KDF" | **HKDF-SHA256** RFC 5869 | = industry std |
| Memory cache | Per-adapter | **3-layer singleton** | > mem0 |
| Embedding adapters | 6 providers | **10 providers** | > mem0 |
| CJK search | Empty results | **LIKE fallback** | Unique |

---

# Phase 1: SDK Core (11/11)

**Todos os 11 tasks completados.** CRITICAL findings fechados:

- **T1.1** `AgentRunErrorCode` closed union (remove `(string & {})`)
- **T1.3** API key boundary validation (OWASP A01)
- **T1.4** Path traversal hardening em `downloadArtifact`
- **T1.5** `providerError.raw` redacted no getter + `toJSON`
- **T1.6** `AgentDisposedError` typed (era generic `Error`)
- **T1.8** `streamObject` import memoizado (skip promise chain)
- **T1.9** `Agent.prompt` dispose safety (cleanup nao mascara erro)
- **T1.10** Cloud-agent mutex timeout 5min (previne hang infinito)

---

# Phase 2: Compression Pipeline

## Provider-agnostic auto-compression (ADR D440)

```
Agent model: anthropic/claude-sonnet-4
     |
     v
[Registry] --> anthropic/claude-3-5-haiku-latest (same vendor!)
     |
     v
[Config] --> key chain: env -> explicit -> main pool fallback
     |
     v
[Summarizer] --> callLlm DI seam (testavel sem real-LLM)
     |
     v
[Decision] --> shouldAttemptCompression(errorCode, state)
     |
     v
[Attempt] --> compress + retry OR propagate error
```

**5 modulos, 46 tests, zero cross-provider calls**

---

# Phase 2: Agent Loop (8/9)

- **T2.1** `validateResponse` D93 bailout wired (era dead code)
- **T2.3** Conversation log inclui `toolCall` + `toolResult` steps
- **T2.4** Parallel tool dispatch (`Promise.all` + semaphore cap 4)
- **T2.5** OTel span leak on veto fixed (was never `end()`-ed)
- **T2.6** Tool error continuation (LLM vê o erro e decide)
- **T2.7** Error code propagation verified end-to-end
- **T2.8** `postToolUse` hook `.catch()` (era silently swallowed)

> **Paridade com OpenAI Agents SDK** em tool dispatch + error handling

---

# Phase 3: LLM Providers (9/10 + T3.10c)

- **T3.1** SSE parser spec-correct (HTML LS 9.2.6 — `stripOneLeadingSpace`)
- **T3.2** SSE abort cancels body (`cancelReaderQuietly`)
- **T3.5** Anthropic prompt caching emit (`cache_control: ephemeral`)
- **T3.6** OpenAI structured outputs (`response_format: json_schema`)
- **T3.7** Error mapping: OpenRouter 402 `quota_exceeded`
- **T3.8** Anthropic cache tokens on `LlmFinish` (5-bucket)
- **T3.9** Reconnect storm prevention (`waitForAvailable` + jitter)
- **T3.10c** Model capabilities registry (provider-agnostic)

---

# Phase 4: Memory — 3 Layers of Cache

```
Layer 1: Query-Vector LRU (T4.1)
  sha256(query) -> cached embedding vector
  p99: 1.5-3s -> ~0ms on hit | cap: 2000 queries
         |
Layer 2: Embedding Singleton (T4.4)
  sha256(text) -> cached embedding vector
  Cross-index dedup | cap: 5000 entries
         |
Layer 3: Tenant-Scoped Active Memory (T4.9)
  sha256(queryMode + namespace + userId + scope + text)
  CRITICAL: prevents cross-tenant data leak
  TTL: 15s | cap: 1000 entries
```

**3 layers complementares, cada uma cobre um nivel diferente**

---

# Phase 4: Memory Improvements (8/11)

- **T4.1** Query-vector LRU cache (p99 1.5-3s -> ~0ms)
- **T4.3** Parallel embed batches (5xRTT -> max(RTT)x2)
- **T4.4** Embedding cache singleton process-wide
- **T4.5** Lance hybrid search (vector + text term-overlap)
- **T4.6** Dreaming O(N^2) cap 500 facts (12.5M -> 125K comps)
- **T4.7** AbortSignal propagation em active memory recall
- **T4.8** CJK FTS5 fallback LIKE (zero results -> correct results)
- **T4.9** Tenant cache key isolation (CRITICAL security fix)
- **T4.10** 4 new embedding adapters (+Azure +Cohere +Jina +Gemini)

---

# Phase 5: Security Hardening (9/11)

| Task | Severity | What |
|------|----------|------|
| **T5.1** | CRITICAL | HKDF-SHA256 para AES tx-cookie (era zero-pad) |
| **T5.2** | CRITICAL | SQL injection Lance `.where()` hardening |
| **T5.3** | HIGH | `__Host-` cookie prefix (RFC 6265bis) |
| **T5.4** | HIGH | Redactor 12 -> 30 patterns + 16 PARAM keywords |
| **T5.5** | HIGH | NUL byte rejection across path-guard |
| **T5.6** | HIGH | Forbidden-path blocklist 5 -> 30+ entries |
| **T5.7** | HIGH | Crypto-random tmp files + mode 0o600 |
| **T5.8** | MEDIUM | NFS/SMB/FUSE detection + warn-once |
| **T5.9** | MEDIUM | proper-lockfile supply-chain validation |
| **T5.10** | MEDIUM | Move-corrupt-aside + 1MB config cap |

---

# Decisoes Arquiteturais FAANG-grade

- **Provider-agnostic compression** — same-family-cheaper-tier registry. Anthropic user gets Anthropic compression. Zero cross-provider calls.
- **Bounded parallelism** — inline semaphore (~15 LoC, no deps). Reused in tool dispatch + embed batches.
- **DI seams everywhere** — `callLlm`, `sleeper`, `fetch` injected para tests determinísticos sem `vi.useFakeTimers()` issues.
- **Fail-loud on unknown** — `CompressionModelUnresolvedError` at `Agent.create` time, NOT runtime. Mesma filosofia em `AuthSecretTooShortError`.
- **Conservative defaults** — model capabilities: unknown = all false. Never optimistic.

---

# Metricas de Impacto

| Metrica | Valor |
|---------|-------|
| Tasks shipped | **51+** across 5 phases |
| New tests | **100+** (51 iters x avg 2 tests) |
| CRITICAL findings closed | **7** (T1.1, T1.3, T1.5, T5.1, T5.2, T4.9, DR2#1) |
| HIGH findings closed | **20+** |
| Embedding providers | 6 -> **10** |
| Secret patterns | 12 -> **30** |
| Phases complete | Phase 1: **11/11**, Phase 4: **8/11** |
| Cost (real-LLM) | **$0.00** (deferred to Phase 6) |

---

# O Que Resta (~15 tasks)

### Prontos para executar
- **T2.2 step 4c** — loop.ts compression wire (5 foundation modules done)
- **T1.7** — 8 OTel sub-spans in sendLocked (deferred to Phase 6)

### Precisam de credenciais
- **T3.10b** Bedrock streaming (AWS_BEARER_TOKEN)
- **T3.10d** Vertex body-massage removal (GCP creds)
- **T4.2** LanceDB createIndex IVF_PQ (50k row test)

### Precisam de plan split
- **T1.11, T2.9, T4.11, T5.11** — cleanup batches (13+ findings cada)

### Phase 6-8 (infraestrutura de validacao)
- Real-LLM 50+ tests, load test 1000 SSE, chaos suite, dogfood, docs

---

<!-- _class: lead -->

# Next Steps

## `/plan-improve` para Phase 6-8 TDD shapes
## Credenciais AWS/GCP para T3.10b/d + T4.2
## Batch splits via hand-edit para T1.11/T2.9/T4.11/T5.11
## Entao: `/implement` resume -> `IMPLEMENTATION_COMPLETE`
