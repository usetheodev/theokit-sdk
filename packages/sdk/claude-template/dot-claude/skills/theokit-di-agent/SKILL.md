---
user-invocable: false
description: All 15 agentic decorators from @theokit/di-agent for tools, workflows, evals, cron, and more.
paths:
  - "**/*decorator*"
  - "**/*Decorator*"
  - "**/di-agent*"
---

# TheoKit DI-Agent -- Agentic Decorators

Quick reference for `@theokit/di-agent` -- 15 decorators that wire agentic capabilities into DI-managed classes.

## Installation

```bash
pnpm add @theokit/di-agent @theokit/di @theokit/sdk
```

Requires `reflect-metadata` and TypeScript decorator support (see `@theokit/di` docs).

## createAgentProvider

Bridges `@theokit/di` container with `@theokit/sdk` Agent. Reads decorator metadata from all registered classes and wires tools, workflows, evals, cron jobs, etc.

```typescript
import { Container } from "@theokit/di";
import { createAgentProvider } from "@theokit/di-agent";

const container = new Container();
container.register(MyToolService);
container.register(MyWorkflowService);

const { agent, dispose } = await createAgentProvider(container, {
  apiKey: process.env.THEOKIT_API_KEY!,
  model: { id: "google/gemini-2.0-flash-001" },
  local: { cwd: process.cwd() },
});
```

## @Tool

Registers a method as a custom tool exposed to the LLM.

```typescript
import { Injectable } from "@theokit/di";
import { Tool } from "@theokit/di-agent";
import { z } from "zod";

@Injectable()
class MathService {
  @Tool({
    name: "calculate",
    description: "Evaluate a math expression.",
    inputSchema: z.object({ expression: z.string() }),
  })
  calculate(input: { expression: string }): string {
    return String(eval(input.expression));
  }
}
```

## @Workflow

Marks a method as a workflow step definition.

```typescript
import { Workflow } from "@theokit/di-agent";

@Injectable()
class PipelineService {
  @Workflow({ name: "data-pipeline", description: "ETL workflow." })
  async run(input: { source: string }) {
    // workflow implementation
  }
}
```

## @EvalDecorator

Registers an eval suite on a method.

```typescript
import { EvalDecorator } from "@theokit/di-agent";

@Injectable()
class QAService {
  @EvalDecorator({
    name: "qa-smoke",
    dataset: [{ input: "Say ok.", expected: "ok" }],
  })
  async evaluate() { /* ... */ }
}
```

## @Cron

Registers a cron-scheduled agent task.

```typescript
import { Cron } from "@theokit/di-agent";

@Injectable()
class ReportService {
  @Cron({
    expression: "0 9 * * *",
    timezone: "America/Sao_Paulo",
    message: "Summarize yesterday's commits.",
  })
  async dailyReport() { /* ... */ }
}
```

## @Subscription

Marks a method as a real-time subscription handler.

```typescript
import { Subscription } from "@theokit/di-agent";

@Injectable()
class EventService {
  @Subscription({ topic: "orders.created", description: "Handle new orders." })
  async onOrder(event: unknown) { /* ... */ }
}
```

## @Auth

Registers authentication/authorization logic for agent operations.

```typescript
import { Auth } from "@theokit/di-agent";

@Injectable()
class SecurityService {
  @Auth({ strategy: "bearer", description: "JWT validation." })
  async validate(token: string): Promise<boolean> { /* ... */ }
}
```

## @Retriever

Registers a retrieval method for RAG pipelines.

```typescript
import { Retriever } from "@theokit/di-agent";

@Injectable()
class SearchService {
  @Retriever({ name: "docs-search", description: "Search documentation." })
  async search(query: string) { /* ... */ }
}
```

## @Reranker

Registers a reranking method for RAG pipelines.

```typescript
import { Reranker } from "@theokit/di-agent";

@Injectable()
class RankService {
  @Reranker({ name: "cohere-reranker", model: "rerank-v3.5" })
  async rerank(query: string, docs: unknown[]) { /* ... */ }
}
```

## @TextSplitter

Registers a text splitting strategy.

```typescript
import { TextSplitter } from "@theokit/di-agent";

@Injectable()
class SplitterService {
  @TextSplitter({ strategy: "recursive", chunkSize: 1000, overlap: 100 })
  split(text: string) { /* ... */ }
}
```

## @UseSandbox

Marks a class or method for sandboxed execution.

```typescript
import { UseSandbox } from "@theokit/di-agent";

@Injectable()
class CodeRunner {
  @UseSandbox({ enabled: true })
  async execute(code: string) { /* ... */ }
}
```

## @SubAgent

Declares a subagent definition on a method.

```typescript
import { SubAgent } from "@theokit/di-agent";

@Injectable()
class AgentOrchestrator {
  @SubAgent({
    name: "code-reviewer",
    description: "Expert code reviewer.",
    prompt: "Review for bugs and security issues.",
  })
  async review() { /* ... */ }
}
```

## @Hitl (Human-in-the-Loop)

Marks a method as requiring human approval before proceeding.

```typescript
import { Hitl } from "@theokit/di-agent";

@Injectable()
class ApprovalService {
  @Hitl({ description: "Requires manager approval.", timeout: 3600_000 })
  async approve(request: unknown) { /* ... */ }
}
```

## @AutoSummarize

Enables automatic conversation summarization.

```typescript
import { AutoSummarize } from "@theokit/di-agent";

@Injectable()
class ChatService {
  @AutoSummarize({ maxTurns: 20, strategy: "rolling" })
  async chat() { /* ... */ }
}
```

## @InjectAgent

Injects the current `SDKAgent` instance into a class.

```typescript
import { Injectable } from "@theokit/di";
import { InjectAgent } from "@theokit/di-agent";
import type { SDKAgent } from "@theokit/sdk";

@Injectable()
class AgentAwareService {
  constructor(@InjectAgent() private readonly agent: SDKAgent) {}

  async doWork() {
    const run = await this.agent.send("Do something");
    await run.wait();
  }
}
```

## @MemoryScopeDecorator

Configures memory scope for a class.

```typescript
import { MemoryScopeDecorator } from "@theokit/di-agent";

@Injectable()
@MemoryScopeDecorator({ namespace: "billing", scope: "user" })
class BillingService { /* ... */ }
```

## Reading metadata (for framework authors)

Each decorator has a companion reader function:

```typescript
import { readToolMetadata } from "@theokit/di-agent";
import { readWorkflowMetadata } from "@theokit/di-agent";
import { readCronMetadata } from "@theokit/di-agent";
// ... readEvalDecoratorMetadata, readRetrieverMetadata, etc.

const tools = readToolMetadata(MyToolService);
```

## AGENT_TOKEN

```typescript
import { AGENT_TOKEN } from "@theokit/di-agent";
// Symbol token for agent injection in the DI container
```
