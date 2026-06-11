# TheoKit RAG Agent

A retrieval-augmented generation agent that indexes local documents with `Memory.openIndex`, exposes a `search_knowledge` tool via `defineTool`, and answers questions by citing relevant context from your knowledge base.

## Usage

```bash
# Place markdown or text files in .theokit/memory/
export THEOKIT_API_KEY="your-key"

# Ask a question (defaults to a summary query)
npx tsx src/index.ts "How does authentication work?"
```
