---
type: Reference
title: Import map
description: Every public entry point of @theokit/sdk and @theokit/sdk-tools in one block, grouped by task, with the one import rule that prevents a catch that does not catch.
tags: [reference, imports, api]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
stale_after: 2026-11-06
sources:
  - id: course
    resource: docs/course/theokit-agent-ai-course.md (v1.0, 2026-07-30), Appendix A, absorbed into this bundle 2026-08-06
    title: Agent AI course, Appendix A — import map, verified at @theokit/sdk@4.36.0
    author: human:paulohenriquevn
    last_modified: 2026-07-30
  - id: map
    resource: /reference/harness-capability-map.md
    title: The capability map — the resolve-checked index this summarizes
---

# Scope of this page

A flat, copy-pasteable index, verified at `@theokit/sdk@4.36.0` on 2026-07-30. The
authoritative, gate-verified version — where every import line is checked at runtime by
`scripts/check-capability-map.mjs` — is
[the capability map](/reference/harness-capability-map.md). When the two disagree, that one
wins, and this page is the defect.

```typescript
// Core
import { Agent, AgentBuilder, AgentFactory, Tool, Plugin, Provider, Squad, Task,
         Theokit, Cron, PermissionEngine, PermissionPlugin, Memory, Security,
         Budget, UsageAccumulator, computeCost, normalizeUsage, getPricingEntry,
         createCounterBudgetTracker, EventBus, JobQueue, Skill, SkillReadTool,
         ToolError, TokenLimiter, UnicodeNormalizer } from "@theokit/sdk";

// Errors and classification
import { isTransientError, TheokitAgentError, RateLimitError, NetworkError,
         AuthenticationError, ConfigurationError } from "@theokit/sdk/errors";

// Sub-entries (~30 in total)
import { Retry } from "@theokit/sdk/retry";
import { mapWithConcurrency, Semaphore } from "@theokit/sdk/concurrency";
import { estimateTokens, shouldCompact, compactTranscript, buildCheckpoint,
         filterFromLatestCheckpoint, isContextOverflowError } from "@theokit/sdk/compaction";
import { assistantText, extractToolUses, costAmountUsd } from "@theokit/sdk/messages";
import { resolveModelCapabilities, parseModelId, humanizeModelName } from "@theokit/sdk/models";
import { discoverSkills, buildSkillsBlock } from "@theokit/sdk/skills";
import { readProjectInstructions, writeProjectInstructions } from "@theokit/sdk/project";
import { withSubagentToolScope, subagentToolWhitelist } from "@theokit/sdk/subagents";
import { safePathJoin, sanitizeIdentifier, safeFilenameForId,
         assertNoSymlinkEscape, isForbiddenPath } from "@theokit/sdk/path-safety";
import { appendJsonl, readJsonlIds, loadJsonl, replaceFileAtomic,
         withFileLock, openSqliteResilient } from "@theokit/sdk/persistence";
import { Eval, Scorers, assertEval, EvalThresholdError } from "@theokit/sdk/eval";
import { LocalSandbox, provisionRepo } from "@theokit/sdk/sandbox";
import { Workflow, WorkflowBuilder, agentStep, fn, workflowStep,
         cloneWorkflow, workflowAsTool } from "@theokit/sdk/workflow";
import { InMemoryTaskStore, JsonFileTaskStore, getTaskStoreFor } from "@theokit/sdk/task-store";
import { Subscription, subscribe, tracked } from "@theokit/sdk/subscription";
import { AgentMailbox, MessageBus, SubAgent } from "@theokit/sdk/a2a";
import { TheoKitClient } from "@theokit/sdk/client";
import { Auth, validateReturnTo } from "@theokit/sdk/server/auth";
import { toEnvelope, fromEnvelope } from "@theokit/sdk/server/errors-envelope";

// Code-assistant toolbox
import { createReadFileTool, createWriteFileTool, createEditFileTool, createShellTool,
         createGlobTool, createSearchTextTool, createWebFetchTool, createWebSearchTool,
         screenedFetch, isBlockedIp, resolveAndScreen, catastrophicShellReason,
         denyCatastrophicCommands, buildRepoMap, buildEnvContext,
         truncateOutput, formatDiff } from "@theokit/sdk-tools";
```

# The import rule

> Pick **one** entry for errors — the barrel **or** `/errors` — and use it consistently.
> `instanceof` is sensitive to class identity, so mixing entries produces a `catch` that does
> not catch.

Why that bites in practice is in [failure taxonomy](/sdk/failure-taxonomy.md).

# Semver status of the sub-paths

Public `@theokit/sdk/*` and `@theokit/sdk-tools` sub-paths are **semver-protected**. The
`@theokit/sdk/internal/*` sub-paths are **semver-exempt** and may break — prefer the public
homes listed above.

# Which entry for which task

| Task | Entry |
| --- | --- |
| Build and run an agent | barrel — [agent, run and SDKMessage](/sdk/agent-run-sdkmessage.md) |
| Classify and retry a failure | `/errors`, `/retry` — [failure taxonomy](/sdk/failure-taxonomy.md) |
| Budget the context window | `/compaction` — [context engineering](/concepts/context-engineering.md) |
| Read the stream without walking blocks | `/messages` — [observation channels](/sdk/observation-channels.md) |
| Orchestrate deterministically | `/workflow` — [workflow](/sdk/workflow.md) |
| Prove it works | `/eval` — [evaluation](/operations/evaluation.md) |
| Bound concurrency, resume a batch | `/concurrency`, `/persistence` — [concurrency and scheduling](/operations/concurrency-and-scheduling.md) |
| Defend the six vectors | `/path-safety`, `@theokit/sdk-tools` — [attack surface](/concepts/attack-surface.md) |

The fact that these sub-entries are usable **in isolation** — you can use `compactTranscript`
without ever using `Agent` — is one of the four genuine differentiators listed in
[framework comparison](/ecosystem/framework-comparison.md).[^map]

[^map]: Harness capability map, the resolve-checked index
