# Dimension Scores — `@theokit/sdk` vs `adk-js`

Phase 5. Score = target quality **relative to reference** (5 = on par with or better). Weighted by registered dimension weight.

| Dimension | Category | Weight | Score | Bar |
|---|---|---:|---:|---|
| Error Handling | error_handling | 1.5 | **5.0** | `██████████` |
| API Design & DX | api_design | 1.5 | **4.5** | `█████████░` |
| Build & Tooling | devops | 1.0 | **4.5** | `█████████░` |
| Folder Organization & Layering | architecture | 1.5 | 4.0 | `████████░░` |
| Design Patterns | design_patterns | 1.0 | 4.0 | `████████░░` |
| Provider / Model Abstraction | api_design | 1.0 | 4.0 | `████████░░` |
| Observability & Telemetry | observability | 1.0 | 4.0 | `████████░░` |
| Modularity & Code Organization | code_organization | 1.0 | 4.0 | `████████░░` |
| Dependency Injection & Extensibility | architecture | 1.5 | 3.5 | `███████░░░` |
| Streaming & Concurrency Model | performance | 1.0 | 3.5 | `███████░░░` |
| Testing Strategy | testing | 1.5 | 3.0 | `██████░░░░` |
| Session & State Persistence | architecture | 1.0 | 3.0 | `██████░░░░` |
| Agent Composition | design_patterns | 1.0 | 3.0 | `██████░░░░` |
| Security & Auth | security | 1.5 | **2.5** | `█████░░░░░` |

## Weighted result

```
∑(weight · score) / ∑(weight)  =  3.750 / 5   →   75.0%
```

Total weight = 17.0. Weighted score sum = 63.75.

## Consistency (cross-validation against gaps)

| Lowest dimensions | Score | Aligned high-severity gaps |
|---|---|---|
| Security & Auth | 2.5 | OAuth2/OIDC exchange+refresh; security policy-engine plugin |
| Testing Strategy | 3.0 | No green-gated conformance/integration/e2e tiers |
| Session & State Persistence | 3.0 | No relational/multi-DB session store |
| Agent Composition | 3.0 | No typed composite agents; no agent-as-tool |

No score contradicts a critical gap — the scoring is internally consistent. Highest dimensions (Error Handling, API/DX, Build) correspond to the 4 "target-better" findings.

## Verdict band

**75% — "Strong, with clear enterprise-surface gaps."** The target matches or beats the reference on developer-facing quality (errors, DX, tooling, multi-provider) but trails on enterprise/runtime surfaces the reference inherits from Google Cloud (delegated auth, relational sessions, conformance testing, declarative multi-agent topologies).
