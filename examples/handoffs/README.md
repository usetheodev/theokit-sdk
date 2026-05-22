# example: agent handoffs

Triage agent → billing/support specialist. Demonstrates the
`handoffs: []` declarative API.

## Run (Ollama)

```bash
ollama serve &
ollama pull llama3.2:3b
pnpm install
pnpm run run
```

## Run (OpenRouter cloud)

```bash
export OPENROUTER_API_KEY=sk-or-...
pnpm run run
```

## What it shows

- `Agent.create({ handoffs: [billing, support] })` declares peer-to-peer transfers (ADRs D214-D229).
- `RECOMMENDED_HANDOFF_PROMPT_PREFIX` exported as a constant; including it in the sender's system prompt makes the LLM use the transfer tools reliably.
- `Handoff.create(target, { toolDescription })` shows the customization escape hatch.
- Each handoff is exposed to the LLM as `transfer_to_<receiver_name>`; the LLM decides based on the user's intent.

## Model quality dependency (EC-14)

Handoffs require reliable function-calling. Tested combinations:

| Model | Reliability |
|---|---|
| `openai/gpt-4o-mini` (cloud) | ✅ Excellent |
| `anthropic/claude-3-5-haiku` (cloud) | ✅ Excellent |
| `ollama/llama3.2:3b` (local) | ⚠️ Inconsistent — small models often skip the transfer tool |
| `ollama/qwen2.5:7b` (local) | ✅ Good |
| `ollama/llama3.1:8b` (local) | ✅ Good |
| `ollama/mistral:7b` (local) | ✅ Good |

**Rule of thumb:** local models under ~7B params struggle with the handoff
tool-call decision (~30% miss rate observed). For local development, prefer
7B+ models OR test with `Agent.handoffTo` imperative as fallback.

## Cost tradeoff for deep chains (EC-12)

Full conversation history is passed to each receiver by default (D216). For
chains depth > 2, consider `Handoff.create(target, { inputFilter: summarize })`
to bound token cost. Token totals stack across hops; a 3-hop chain on a
5-message history roughly triples the prompt tokens.

## Loop protection

- `maxHandoffDepth: 5` per `send()` (default; D218). Override via `Agent.create({ maxHandoffDepth: N })`.
- Set `maxHandoffDepth: 0` to disable handoffs entirely (EC-8 — tools never fire).
- Pair single-flight (D221): A → B → A within the same `send()` throws `HandoffPairLoopError`. Use a 3rd agent for legitimate "back to triage" patterns.
