# Blueprint: M3-6 — Catastrophic shell at the agents/permission layer

> Design source for a composable command-policy layer in `@theokit/sdk-tools`: `type CommandPolicy = (command: string) => string | null` + `denyCatastrophicCommands(): CommandPolicy` (composing the M3-2 `catastrophicShellReason`) + `commandDenialReason(command, policies): string | null` (first deny reason) + `isCommandAllowed(command, policies): boolean`. Backed by codex (`command_safety/is_dangerous_command.rs` + `is_safe_command.rs` predicate composition), opencode (`permission/schema.ts` allow/deny/ask effect), the in-repo ACP `pre_tool_call` veto (`packages/acp/src/permission-plugin.ts`), and the M3-2 reason-or-null primitive (`packages/sdk-tools/src/internal/shell-guard.ts:188`). `@theokit/agents` does NOT exist — the policy is a pure predicate in sdk-tools (next to M3-2), wired at the consumer's permission layer (KISS, no new package). Discovery plan: `m3-command-policy` (discover-plan-confidence SHIPPABLE 100).

**Slug:** `m3-command-policy` · **Date:** 2026-06-21 · **Owner:** paulo

## Context

Greenfield: no `isCommandAllowed`/`denyCatastrophicCommands`/`CommandPolicy`. M3-2 shipped `catastrophicShellReason(cmd): string | null`. The existing permission concept is ACP's `pre_tool_call` veto. M3-6 composes M3-2 into a small, framework-agnostic policy layer (deny-wins), reusing the reason-or-null idiom; no new package, no deny-list duplication.

## Objective

Decide `CommandPolicy` + `denyCatastrophicCommands()` + `commandDenialReason(command, policies)` + `isCommandAllowed(command, policies)` + the deny-wins composition + the empty-list-allows-all boundary — zero new deps, composing M3-2. Backed by codex + opencode + ACP + M3-2.

## Coverage Corner 1 — Integration Tests

| Source | What it tests | Seeds these SDK RED tests |
|---|---|---|
| codex `command_safety/is_dangerous_command.rs` (`.claude/knowledge-base/reference/codex/codex-rs/shell-command/src/command_safety/is_dangerous_command.rs`) | dangerous command → blocked; safe → allowed | `denyCatastrophicCommands()` denies `rm -rf /`, allows `ls` |
| in-repo ACP `permission-plugin.ts` (`packages/acp/src/permission-plugin.ts`) | a `pre_tool_call` veto blocks a tool call | a consumer can call `isCommandAllowed` inside a `pre_tool_call` hook to block shell_exec |
| in-repo M3-2 `shell-guard.test.ts` | `catastrophicShellReason` reason set | the policy reflects the SAME reasons (no duplicate deny-list) |

**SDK RED test set:** catastrophic cmd → `isCommandAllowed` false + `commandDenialReason` returns the reason; safe cmd → allowed + null; multiple policies → first-deny-wins (the first policy returning a reason is the denial); empty policy list → allows everything (`isCommandAllowed(cmd, [])` true, `commandDenialReason(cmd, [])` null); `denyCatastrophicCommands()` reason === `catastrophicShellReason` reason (composition, not duplication).

## Coverage Corner 2 — Dependencies

| Project | Policy deps | Portable? |
|---|---|---|
| codex | Rust std + internal parser | concept only |
| opencode | Effect + zod schema | NO |
| in-repo | `catastrophicShellReason` + Array ops | YES — direct |

**Verdict:** ZERO new deps — `denyCatastrophicCommands` calls `catastrophicShellReason`; `commandDenialReason`/`isCommandAllowed` are `Array.prototype` ops. No deny-list duplication (Unbreakable Rule 9 / KISS).

## Coverage Corner 3 — Tools

Module / export shape:
- M3-2 `catastrophicShellReason(cmd): string | null` (`packages/sdk-tools/src/internal/shell-guard.ts:188`) — the composed primitive.
- codex `is_dangerous_command.rs` `command_might_be_dangerous(command) -> bool` + `is_safe_command.rs` — boolean predicates combined into an allow decision.
- opencode `permission/schema.ts` (`.claude/knowledge-base/reference/opencode/packages/core/src/permission/schema.ts`) — `effect: "allow" | "deny" | "ask"`.
- in-repo sibling composable functions (`tool-guidance.ts`, `tool-aci.ts`) — the pure-function-in-internal/ + barrel pattern.

**SDK module shape:** `packages/sdk-tools/src/internal/command-policy.ts`, barrel-exported:
```
type CommandPolicy = (command: string) => string | null   // deny reason, or null if this policy allows
denyCatastrophicCommands(): CommandPolicy                  // = (cmd) => catastrophicShellReason(cmd)
commandDenialReason(command: string, policies: CommandPolicy[]): string | null  // first non-null reason
isCommandAllowed(command: string, policies: CommandPolicy[]): boolean           // = commandDenialReason === null
```

## Coverage Corner 4 — Techniques

### Technique 1 — deny-wins composition (reason-or-null) (Q4)

```
denyCatastrophicCommands() = (command) => catastrophicShellReason(command)
commandDenialReason(command, policies):
  for p in policies: r = p(command); if r !== null return r
  return null
isCommandAllowed(command, policies) = commandDenialReason(command, policies) === null
```
Mirrors the M3-2 reason-or-null idiom: a policy returns a deny REASON or null (allow). The composite denies on the FIRST policy that returns a reason (deny-wins, codex-style dangerous-check short-circuit). An empty policy array denies nothing → `isCommandAllowed(cmd, [])` is true (EC-1).

### Technique 2 — pure-predicate integration (no new package, no runtime coupling) (Q5)

The policy is a pure, framework-agnostic predicate. A consumer wires it at their permission layer — e.g. inside an ACP `pre_tool_call` hook:
```
// consumer pattern (documented, NOT shipped):
on("pre_tool_call", (ctx) => {
  if (ctx.name === "shell_exec") {
    const reason = commandDenialReason(ctx.args.command, [denyCatastrophicCommands()]);
    if (reason) return { block: true, message: `Command refused: ${reason}` };
  }
});
```
No `@theokit/agents` package is created; the glue is the consumer's (KISS). The policy inherits M3-2's honesty: a heuristic gate, not a sandbox (EC-2).

## Cross-cutting Comparison

| Dimension | codex | opencode | in-repo ACP / M3-2 | SDK decision |
|---|---|---|---|---|
| decision shape | bool (dangerous/safe) | effect enum | veto `{block,message}` / reason-or-null | reason-or-null `CommandPolicy` |
| composition | safe overrides dangerous | rule list | single plugin | deny-wins over a policy array |
| primitive | internal parser | rule resource | `catastrophicShellReason` | composes M3-2 (no dup) |
| deps | Rust std | Effect+zod | none | none |
| integration | built-in | runtime | plugin | pure predicate + documented glue |

## ADRs

### D1 — `CommandPolicy` = reason-or-null; deny-wins composition
**Decision:** `type CommandPolicy = (command: string) => string | null`; `commandDenialReason` returns the first non-null; `isCommandAllowed` = that === null.
**Rationale:** mirrors the M3-2 reason-or-null idiom (consistent + the reason powers messaging); deny-wins matches codex's dangerous-check short-circuit.
**Alternatives considered:** boolean policy (rejected — loses the reason); effect enum allow/deny/ask (rejected — over-scope; ask is a runtime/ACP concern, not a pure policy).

### D2 — `denyCatastrophicCommands()` composes M3-2, never duplicates
**Decision:** `denyCatastrophicCommands() = (cmd) => catastrophicShellReason(cmd)`.
**Rationale:** single source of the deny-list (Rule 9); the policy reason IS the M3-2 reason.
**Alternatives considered:** re-implement the patterns here (rejected — duplication, drift).

### D3 — empty policy list allows everything
**Decision:** `isCommandAllowed(cmd, [])` true; `commandDenialReason(cmd, [])` null.
**Rationale:** no policies = no denial (a sane default); `Array` iteration over [] yields null naturally (EC-1).
**Alternatives considered:** default-deny on empty (rejected — surprising; a consumer opts in to policies).

### D4 — pure predicate; no new package; plugin glue documented, not shipped
**Decision:** the policy lives in `sdk-tools/internal/command-policy.ts` (next to M3-2), framework-agnostic; the ACP/`pre_tool_call` wiring is a documented consumer pattern.
**Rationale:** `@theokit/agents` does not exist; creating one for a low/size-S task violates KISS; a pure predicate composes anywhere.
**Alternatives considered:** create `@theokit/agents` (rejected — over-scope); ship an ACP plugin (rejected — couples sdk-tools to acp; YAGNI).

### D5 — Placement + barrel export
**Decision:** `packages/sdk-tools/src/internal/command-policy.ts`; barrel-export `CommandPolicy`, `denyCatastrophicCommands`, `commandDenialReason`, `isCommandAllowed`.
**Rationale:** sibling of `shell-guard.ts`; internal/ for logic, barrel for reuse.
**Alternatives considered:** in `@theokit/sdk` core (rejected — it composes sdk-tools' shell-guard).

## Recommendations for the project

1. Implement `CommandPolicy` + `denyCatastrophicCommands()` + `commandDenialReason` + `isCommandAllowed` in `packages/sdk-tools/src/internal/command-policy.ts`, composing `catastrophicShellReason`, zero deps, barrel-exported (D1/D2/D5).
2. Deny-wins over a policy array; reason-or-null mirrors M3-2; empty list allows all (D1/D3).
3. Keep the policy a pure predicate; document (not ship) the ACP `pre_tool_call` glue (D4).
4. TDD: catastrophic denied (+reason === M3-2 reason); safe allowed; first-deny-wins across two policies; empty list allows all.
5. No `@theokit/agents` package; no deny-list duplication.

## Blocked questions (if any)

- (none) — design fully resolved; the policy is a pure composition of the shipped M3-2 primitive.
