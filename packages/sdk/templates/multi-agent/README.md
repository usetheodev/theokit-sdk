# TheoKit Multi-Agent

A multi-agent system using `TheoKitContainer` to manage three specialist agents: a classifier that routes input, a summarizer that condenses text, and a translator that handles language conversion. Demonstrates the container pattern for coordinating multiple agents from a single registry.

## Usage

```bash
export THEOKIT_API_KEY="your-key"

# Run with custom input
npx tsx src/index.ts "Translate to French: Hello, how are you?"
```
