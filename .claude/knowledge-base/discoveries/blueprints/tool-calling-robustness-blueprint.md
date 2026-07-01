# Blueprint — Robust multi-model tool-calling for `@theokit/sdk`

Discovery synthesis (2026-07-01) from a 6-way deep read of SOTA multi-model agents:
Cline, Vercel AI SDK, opencode, openguardrails-agentfw (MIT), OpenAI Agents SDK (Python),
OpenClaw. Triggered by a production hang (qwen3-coder investigation task) whose root cause is a
**symptom of a broader architectural gap** in our leaked-dialect handling.

> Rule reminder: references are STUDY material. We **adapt patterns and cite**, we do **not** copy
> code (SDK CLAUDE.md). We respect the SDK's deliberate "values are strings; Zod coerces downstream"
> decision. YAGNI: we do not add parsers for dialects no model we route ever emits.

---

## 0. The confirmed root cause (the symptom)

`hermes-tool-extract.ts` `parseHermesParams:78` does `input[key.trim()] = value` — it trims the KEY
but **not the VALUE**. qwen3-coder (default theocode model) leaks the Hermes dialect
`<function=read_file><parameter=path>\npackage.json\n</parameter></function></tool_call>`; the value
carries the XML formatting newlines. `read_file`/`glob_files`/`search_text` then get
`path:"\npackage.json\n"` → `not_found`; `shell_exec` tolerates it (bash ignores blank lines). In an
investigation (many reads) the model loops on `not_found` and never converges → UI "hang". Determinism
proven via a `runCodeAgent` trace; cross-model control (Sonnet, native tool_calls) works. `theocode#35`
(card shows `$\ncmd`) was a **workaround of the same symptom at the render layer**.

## 1. The tool-calling lifecycle (10 stages) — the frame

INPUT PARSE → NORMALIZE → STREAM-RECONSTRUCT → MULTI/PARALLEL → ASYNC DISPATCH → RESULT/OUTPUT →
ERROR-FEEDBACK/SELF-CORRECT → MALFORMED-RECOVERY → RICH RENDER → CROSS-MODEL ABSTRACTION.

## 2. Two camps for INPUT (the key architectural choice)

- **Native-only + repair** — Vercel AI SDK, OpenAI Agents, opencode. Trust native `tool_calls`; on bad
  args, a `repairToolCall` hook (Vercel) or error-to-model self-correction. opencode's own verdict:
  *"absence of text-leakage detection is the single largest production reliability gap."*
- **Stream-level dialect NORMALIZATION** — OpenClaw, Cline, agentfw. Convert leaked text dialects into
  synthetic native `tool_call` events AT THE STREAM BOUNDARY; downstream is dialect-blind. **This is the
  SOTA for multi-model robustness and the camp we half-live-in (badly).**

**Closest reference to OUR exact `<function=><parameter=>` dialect: OpenClaw
`packages/tool-call-repair/`** — a dedicated package that handles 5 dialects (bracket `[tool]{json}`,
XML-ish `<function=><parameter=>`, Harmony `<|channel|>...<|call|>`, `[END_TOOL_REQUEST]`, XML param
bodies), with trim + schema-aware coercion + 3-tier JSON repair + stream-level normalizer +
request-scoped tool-name matching + synthetic IDs. `stream-normalizer.ts` is the reference impl.

## 3. Techniques worth adopting (per stage) — with citations

**PARSE (multi-dialect, robust):**
- Multi-dialect cascade + `ANY_TAG_RE` fast pre-gate + **tolerant fallback** for malformed/unterminated/
  misspelled tags ("last named open wins") — agentfw `xml-tool-calls.ts:47,59-73,231-271`.
- Dialects our models actually emit: `<function=NAME><parameter=KEY>` (qwen3-coder), `<tool_call>{JSON}`
  (Hermes/Qwen JSON), Harmony `<|channel|>...<|call|>` (gpt-oss family). OpenClaw covers all
  (`tool-call-repair/src/grammar.ts`, `payload.ts`).
- **Request-scoped tool-name matching** — only recover a leaked call whose name is in the CURRENT tool
  set — OpenClaw `provider-stream-shared.ts:125`. This is the correct fix for our documented "a code
  assistant printing a literal `<function=` in a fenced block" concern (currently handled only by
  default-off, which is blunt).

**NORMALIZE:**
- **TRIM values** — agentfw `coerceParameter` via `(m[2]??'').trim()` (`:179`); OpenClaw
  `coerceWithJsonSchema`; Cline `normalizeJsonLikeStringsForSchema`. ← the P0 fix.
- **Schema-aware coercion** (string→num/bool, JSON-string→array/object, bounded 64KB) — OpenClaw
  `validation.ts:347-365`; agentfw `coerceParameter:191-208`. NOTE: overlaps our "Zod coerces" decision;
  keep coercion OUT of the extractor, let it stay strings + trim, and let Zod coerce (aligns with Vercel).
- **3-tier JSON repair** (repairJson → JSON.parse → partial-json → `{}`) for the JSON-carrying dialects —
  OpenClaw `parseStreamingJson`; Cline `jsonrepair` + `repairBareObjectValue`.
- **Synthetic stable IDs** for leaked calls (`agentfw_xml_0` / `call_${uuid}`) — agentfw
  `from-openai-chat.ts:100`; OpenClaw `provider-stream-shared.ts:62`.

**STREAM-RECONSTRUCT:**
- Stream-level normalizer: buffer `text_*` while "possible", release as text on "impossible", promote to
  `toolcall_*` on confirmed-complete, with an over-cap buffer (256KB + 64KB tail window) — OpenClaw
  `stream-normalizer.ts`. Cline's `PendingToolAssembly` + interleaved `sequence` array
  (`agent-runtime.ts:843-992`) is the native-tool-calls equivalent.
- Eager finalize: parse-check args on every delta, finalize as soon as parseable — Vercel
  `StreamingToolCallTracker` (`isParsableJson`); opencode `finishWithInput` (final authoritative value
  overrides accumulated deltas).

**PARALLEL / ASYNC:**
- Parallel exec w/ controlled concurrency + failure arbitration — OpenAI Agents
  `_FunctionToolBatchExecutor` (slot-filling, `FIRST_COMPLETED`, priority failure, 0.25s cancel drain).
  Vercel/Cline/OpenClaw: configurable parallel-vs-sequential (any sequential tool → whole batch serial).
- Per-tool timeouts via merged abort signals — Vercel `mergeAbortSignals`+`AbortSignal.any`; OpenAI
  Agents `asyncio.wait_for` with `timeout_behavior: error_as_result | raise`.
- HITL approval as serializable state, not callback — OpenAI Agents `NextStepInterruption` /
  `RunState.approve()`; Vercel signed approvals.

**RESULT / OUTPUT:**
- Multi-layer truncation (per-result 8K + aggregate 6MB + image budget, **middle-truncation** with
  markers) — Cline `message-builder.ts`. Rich result content (text/image/json/structured) via
  `toModelOutput` — Vercel; opencode/OpenClaw carry images in tool results.
- **`addMissingToolResults`** — synthesize placeholder error results for orphaned `tool_use` blocks
  BEFORE dispatch so the provider doesn't 400 — Cline `message-builder.ts:502-600`. High-value.

**ERROR FEEDBACK / SELF-CORRECT (universal):**
- Surface every tool error (parse / validation-with-path / not-found / exec) as the tool_result the model
  sees next turn → self-correction — ALL. Best signal: OpenClaw validation error with JSON-pointer path +
  received args (`validation.ts:377-380`). Vercel `invalid:true`+`tool-error` part (dynamic tools only).
  OpenAI Agents `failure_error_function` (default gives actionable JSON-parse guidance).
- **`repairToolCall` hook** (schema + error + message history → corrected call, one attempt, fires only on
  error) — Vercel `parse-tool-call.ts:51-93`, `tool-call-repair-function.ts`. Gold standard for arg repair.
- **Loop / no-progress detection** — opencode `doom_loop` (same name + `JSON.stringify(input)` over last
  3 parts → ask permission; `processor.ts:519-545`); Cline `LoopDetectionTracker` (soft 3 / hard 5) +
  `MistakeTracker` (max 6). **This alone would have caught our hang** even before the root fix.

**CROSS-MODEL:**
- Provider capability profiles (native-tool support, thinking format, cache format, "leaks dialect?") —
  OpenClaw 16+ flags (`llm-core/types.ts:411-454`), Cline capabilities, Vercel `LanguageModelV4`.
- Per-model quirk registry (Qwen OAuth, Z.ai `tool_stream`, DeepSeek thinking, Gemini `thinkingLevel`) —
  OpenClaw `provider-stream-shared.ts`.

## 4. `@theokit/sdk` gap analysis (baseline)

| Stage | SOTA | Our SDK today | Gap |
|---|---|---|---|
| Leaked-dialect parse | multi-dialect cascade + tolerant fallback | ONE dialect (`<function=>`), no fallback | HIGH |
| Value normalize | trim + coerce + JSON-repair | none (no trim ← the bug) | HIGH |
| Stream-level normalize | at stream boundary | post-hoc at finish only | HIGH |
| False-positive guard | request-scoped name match | default-off flag (blunt) | MED |
| repair hook | Vercel `repairToolCall` | none | MED |
| loop/no-progress | doom-loop / MistakeTracker | theocode `no_progress` (partial) | MED |
| error→model self-correct | universal + rich paths | guidance wrappers (theocode) | LOW-MED |
| parallel exec | controlled + arbitration | (verify) | ? |
| orphaned tool_result repair | Cline addMissingToolResults | none (verify) | MED |
| output truncation | multi-layer middle-truncate | (theocode partial) | LOW |

## 5. Proposed solution — phased (behavior-preserving, adapted-not-copied)

- **P0 (bug fix, ship now):** trim the value in `parseHermesParams` (`value.trim()`), cite agentfw:179.
  TDD: `<parameter=path>\npackage.json\n</parameter>` → `{path:"package.json"}`; multi-line command keeps
  internal `\n`. Then theocode#35's render `.trim()` becomes redundant/defensive.
- **P1 (robustness of the ONE dialect we have):** tolerant matching (whitespace around `<function=`/
  `<parameter=`), synthetic-ID already present, add request-scoped tool-name matching to replace the blunt
  default-off; add JSON-repair only where a dialect carries JSON. Keep values as strings (Zod coerces).
- **P2 (multi-dialect + loop guard):** add the `<tool_call>{JSON}` and Harmony dialects IF we route a
  model that emits them (evidence-gated, YAGNI); add loop/no-progress detection (doom-loop fingerprint) in
  the loop — this is the safety net that turns "silent hang" into "typed stop".
- **P3 (stream-level normalization):** move recovery from finish-only to the stream boundary (OpenClaw
  pattern) so UI/loop are dialect-blind — the true architectural fix; bigger change, own cycle.
- **P4 (repair hook + orphaned-result repair):** optional `repairToolCall`-style hook; `addMissingToolResults`.

## 6. What NOT to do
- Copy any reference file verbatim (rules). Adapt + cite.
- Add coercion INSIDE the extractor (conflicts with the "strings + Zod" decision) — trim only; let Zod coerce.
- Add parsers for dialects no routed model emits (YAGNI). Gate P2 dialects on real evidence.
- Treat P3/P4 as blockers for P0 — P0 fixes the live production break today.

## 7. Licenses / provenance
- agentfw: **MIT** (confirmed) — patterns citeable.
- OpenClaw / Cline / Vercel AI SDK: verify LICENSE before adopting any pattern text; we adapt behavior +
  cite, never copy.

## Cross-refs
- Root cause + trace: session 2026-07-01. Extractor: `packages/sdk/src/internal/llm/hermes-tool-extract.ts`.
- Cloned study repos (scratch, remove after): `tool-calling-study/{cline,ai,openclaw}`.
