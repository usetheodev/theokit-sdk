# ADR 0007 — `defineSkillReadTool` is an opt-in factory, not an auto-injected tool (SE23)

- **Status:** Accepted (2026-07-10)
- **Milestone:** SE23 (SDK Evolution — Mastra Agent-skills parity)
- **Relates:** M22 (`createSkill` / `<skills>` eager block), SE20 (`agent.skills.get`), SE21 (`references` on inline skills)

## Context

Mastra ships built-in `skill_read` / `skill_search` tools that it **auto-injects**
into every agent that has skills, giving the model on-demand access to a skill's
full body. TheoKit takes a different disclosure posture: skills are disclosed
**eagerly** via the `<skills>` system-prompt block (name + description only — never
the body), and tools are **bring-your-own** — the SDK ships zero built-in tools
(see ROADMAP § Explicitly out of scope: "Built-in coding tools … bring-your-own-tools
is the design").

SE21 added `references` to an inline skill and SE20 added `agent.skills.get(name)`
(an APP-facing read). What remained absent was a MODEL-facing lazy read: a way for
the model to pull a skill's body mid-run. The question: do we adopt Mastra's
auto-injected `skill_read`, or something that respects bring-your-own-tools?

## Decision

**Ship `defineSkillReadTool(skills)` as an OPT-IN factory — the SDK never
auto-injects it.** It is a sibling of `defineSubAgent` (agents-as-tools) and
`workflowAsTool` (workflows-as-tools): a factory that returns a `CustomTool` the
consumer explicitly adds to `AgentOptions.tools`. When the model calls it with a
skill name, the handler returns that skill's `instructions` (+ SE21 `references`).
An unknown-but-well-formed name returns a typed **"not found"** string (listing the
available skills) — NOT a throw that kills the run. Malformed input (missing `name`)
fails at the trust boundary via the input schema.

The result is a **hybrid disclosure model**: eager `<skills>` block for discovery
(name + description, no body) + opt-in lazy `skill_read` for the body — the consumer
chooses which skills to expose by choosing what to pass to the factory.

## Consequences

- **Bring-your-own-tools preserved.** No auto-injection, no built-in toolset; an
  agent that does not add the tool is unchanged. The SDK's "we ship a runtime, not a
  toolset" boundary holds.
- **Consumer controls exposure.** Passing `skills` to the factory is an explicit act;
  the model can only read skills the consumer chose to expose.
- **Unknown name is a normal result, not an error** (Rule 8 distinction: a valid
  request for a missing skill is recoverable; malformed args are a boundary failure).
- **Body size** is the consumer's responsibility — the tool returns the body as-is;
  the consumer scopes exposure by their skill selection. A size cap is deferred
  (YAGNI) — a follow-up if demand appears.
- **No new runtime coupling.** The factory is a leaf module (`define-skill-read-tool.ts`)
  depending only on `InlineSkill`, `CustomTool`, and the zod→JSON-schema helper — no
  cycle, no registry, no auto-load path.
- **Name lookup is exact + case-sensitive** — the same identity the `<skills>` block
  uses; the consumer is responsible for naming consistency. Duplicate names fail fast at
  factory construction (a shadowed skill would be silently unreachable).

## Alternatives considered

- **Auto-inject `skill_read` when skills are present (Mastra's default).** Rejected:
  it violates bring-your-own-tools — the SDK would silently add a tool the consumer
  did not declare, and the reserved-name surface would grow. Reopen only if a shipped
  TheoKit app measures friction from the explicit opt-in.
- **`skill_search` (semantic search over skills) too.** Deferred (YAGNI): the eager
  `<skills>` block already lists every skill's name + description for discovery, so a
  search tool has no gap to fill at current skill counts. Reopen with demand evidence
  (an app with enough skills that the eager block is unwieldy).
- **Surface the body through the eager `<skills>` block.** Rejected: the block is a
  prompt-injection-hardened, name+description-only surface by design (M22 / D9);
  folding bodies into it would bloat every system prompt and re-open the injection
  surface. Lazy read via a tool keeps the eager block lean.
