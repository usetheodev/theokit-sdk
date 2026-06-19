# TheoKit Multi-Agent

A multi-agent system that coordinates three specialist agents with the canonical `Agent.create()` factory: a classifier that routes input, a summarizer that condenses text, and a translator that handles language conversion. Demonstrates managing multiple agents from a single config map (ADR D431 — factory functions are the SDK's canonical API).

## Usage

```bash
export THEOKIT_API_KEY="your-key"

# Run with custom input
npx tsx src/index.ts "Translate to French: Hello, how are you?"
```
