# Ollama Hello

Smallest possible `@usetheo/sdk` program running 100% locally against
Ollama (ADR D182). No API keys, no cloud calls.

## Setup

```bash
# 1. Install Ollama (one-time)
#    https://ollama.com/download
#
# 2. Pull a small model (~1.9 GB)
ollama pull llama3.2:3b

# 3. Start the daemon (or skip on macOS app — auto-runs)
ollama serve &

# 4. Build the SDK once (workspace dep)
cd ../..
pnpm install
pnpm build
cd examples/ollama-hello

# 5. Run
pnpm install --ignore-workspace
pnpm start
```

## What it does

1. `Agent.create({ model: "ollama/llama3.2:3b" })` — provider inferred
   from the model prefix; no provider config needed.
2. `agent.send(...)` — streams a real Ollama response token-by-token.
3. Prints the response and exits.

## Pointing at a remote Ollama box

```bash
export OLLAMA_HOST=http://192.168.1.50:11434
pnpm start
```

## Using a different model

```bash
ollama pull qwen2.5:3b
OLLAMA_MODEL=ollama/qwen2.5:3b pnpm start
```

## First-run latency

The first request after `ollama pull` can take 10-60 seconds while the
daemon loads the model into RAM. Subsequent runs are fast.

## Troubleshooting

| Error | Fix |
|-------|-----|
| `ollama_unreachable` | Run `ollama serve` (or open the Ollama app on macOS). |
| `ollama_model_not_pulled` | Run `ollama pull <model>` for the model named in the error. |
| `ollama_model_loading` | Wait 30 seconds and retry — daemon is loading the model into RAM. |
