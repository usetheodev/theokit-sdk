# active-memory-query-modes

Demonstrates the 3 `queryMode` variants of Active Memory.

## Run

```bash
pnpm install --ignore-workspace
cp .env.example .env   # set ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY
pnpm dev
```

## What it shows

`memory.activeRecall.queryMode` controls which conversation slice the
recall sub-agent uses to query the memory index:

| Mode | Query | Trade-off |
|---|---|---|
| `"message"` | Only the current user message | Fastest. Misses context across turns. |
| `"recent"` | Last N user turns + current | Balanced. Recommended default. |
| `"full"` | Entire conversation history | Most thorough. Largest query. |

The example creates a fresh agent for each mode, seeds 2 conversation
turns, then asks a question whose answer is in memory. Each mode emits
the same answer but with different recall fidelity.
