# {{projectName}}

100% local agent via Ollama — scaffolded by `theokit init --template ollama-local`.

## Setup

```bash
# 1. Install Ollama (one-time): https://ollama.com/download
# 2. Pull a model:
ollama pull llama3.2:3b

# 3. Start the daemon (if not already running):
ollama serve &

# 4. Install + run:
pnpm install
pnpm dev
```

No API keys, no cloud calls.

## What this does

- `Agent.create({ model: "ollama/llama3.2:3b" })` — provider inferred from the prefix.
- Streams the reply.
- Documents the local-mode UX in error messages (e.g. "Run `ollama serve`").

## Pointing at a remote Ollama

```bash
export OLLAMA_HOST=http://192.168.1.50:11434
pnpm dev
```

## Using a larger model

```bash
ollama pull qwen2.5:7b
OLLAMA_MODEL=ollama/qwen2.5:7b pnpm dev
```

## Requirements

- Node 22.12+.
- Ollama installed and running.
- ~2GB disk + ~2GB RAM for `llama3.2:3b`.
