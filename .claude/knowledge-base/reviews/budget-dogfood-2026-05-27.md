# Budget Dogfood Report — 2026-05-27

Plan: `token-budget-cost-tracker-plan` v1.2 (Phase 6)
Status: **PASS** (real-LLM end-to-end via Ollama qwen2.5:3b)

## Run

```bash
node tools/validate-budget-real-llm.mjs
```

## Result

```
→ Scenario 1: Pricing registry + computeCost (no LLM call)
  ✓ claude-opus-4-7 1k/500/2k/100 → $0.019125 (estimated)
  ✓ ollama/qwen2.5 → status="unknown" (no pricing) — correct

→ Scenario 2: normalizeUsage 3 API shapes (no LLM call)
  ✓ Anthropic 4-bucket: input=1000 cacheR=2000
  ✓ OpenAI Chat subtract-cached: input=1200 cacheR=1800
  ✓ cline#10266 fallback: cacheR=3000 cacheW=1000

→ Scenario 3: Budget lifecycle (no LLM call)
  ✓ EC-7: empty name throws ConfigurationError
  ✓ EC-16: duplicate name throws ConfigurationError
  ✓ audit mode charged $10 against $0.001 limit without throwing
    spent now: $10
  ✓ block mode preflight throws BudgetExceededError
  ✓ Budget.snapshot() → 3 entries

→ Scenario 4: Real-LLM send + manual normalize + cost compute
  ✓ Ollama responded in 1419ms — status=finished
    reply: "\"Pong\""
  ✓ computeCost for Ollama route returns status="unknown" (correct)

✅ REAL-LLM Budget dogfood PASS
```

## Coverage

| Layer | Result |
|---|---|
| Pricing snapshot lookup direct (`anthropic/claude-opus-4-7`) | ✅ $0.019125 estimated for 1k/500/2k/100 split |
| Pricing snapshot unknown route (Ollama) | ✅ `status="unknown"` + `amountUsd undefined` |
| Alias normalization Anthropic dot→dash (EC-2) | ✅ unit tests + dogfood |
| Alias normalization date-suffix strip (EC-2) | ✅ unit tests |
| OpenRouter prefix variants (EC-11) | ✅ unit tests |
| Anthropic Messages 4-bucket normalize | ✅ scenario 2 |
| OpenAI Chat subtract-cached normalize | ✅ scenario 2 |
| cline#10266 top-level fallback regression | ✅ scenario 2 |
| `BudgetExceededError.mode` field (EC-1) | ✅ unit tests |
| `Budget.create` name grammar validation (EC-7) | ✅ scenario 3 |
| `Budget.create` duplicate throws (EC-16) | ✅ scenario 3 |
| `audit` mode never throws | ✅ scenario 3 |
| `block` mode preflight throws BEFORE LLM | ✅ scenario 3 (BudgetExceededError raised) |
| `Budget.snapshot()` per-window | ✅ scenario 3 (3 entries) |
| Real LLM observed (Ollama qwen2.5:3b) | ✅ scenario 4 (1419ms, "Pong") |

## Scope cut (v1.2 documented)

`RunResult.usage` + `RunResult.cost` auto-populate (T4.2) is **deferred to v0.2**. Caller-side composition path works today:

```ts
import { Budget, computeCost, normalizeUsage, preflightCheck, chargeAndCheckThresholds } from "@theokit/sdk";
// 1. Manually preflight before agent.send (for block-mode budgets)
preflightCheck("my-budget", estimatedUsd);
const run = await agent.send(prompt);
const result = await run.wait();
// 2. Parse provider usage (or get from your LLM client wrapper)
const usage = normalizeUsage(rawResponseUsage, { provider: "anthropic" });
// 3. Compute cost via bundled pricing snapshot
const cost = computeCost({ provider: "anthropic", model: "claude-opus-4-7", usage });
// 4. Apply charge + threshold callbacks
if (cost.amountUsd !== undefined) await chargeAndCheckThresholds("my-budget", cost.amountUsd);
```

## Verdict

Plan Phase 6 acceptance criteria met. Token Budget + Cost Tracker primitive
production-ready as composable API. Auto-wire em `agent.send` é v0.2.
