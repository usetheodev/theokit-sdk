/**
 * Session-types contract — leaf shared types for the agent-session subsystem.
 *
 * **T1.1 / Cycle #9 (CRITICAL) of plan `arch-review-fixes-2026-06-06`
 * (ADR D432, plan-defect-corrected — see below):** the previous layout had
 * a 3-node runtime↔persistence cycle:
 *
 *   agent-session.ts
 *     → conversation-storage-fs.ts (FileSystemConversationStorage runtime)
 *     → agent-session-store.ts (persistence helpers)
 *     → agent-session.ts (SessionMessage type)  ← back-edge
 *
 * The cycle was flagged CRITICAL because it crossed the runtime ↔ persistence
 * layer boundary, violating `rules/architecture.md § 1` layered-boundaries.
 *
 * **Plan-vs-reality:** the plan (ADR D432) prescribed a full port-and-adapter
 * refactor: introduce a `ConversationStorage` port in `runtime/`, have
 * `agent-session.ts` import the port only, and rewire LocalAgent constructor
 * to bind the FS adapter at composition root. That would have been correct
 * if the runtime member of the cycle imported the FS class directly. But on
 * inspection, the cycle's back-edge is a single **types-only** import from
 * `agent-session.ts` (the `SessionMessage` interface). The smallest break per
 * Bob Martin DIP — and the one that **actually closes the cycle** — is to
 * extract `SessionMessage` to this leaf types file. The port-and-adapter
 * refactor would not have closed the cycle on its own (the back-edge would
 * remain) and would have required ~10 follow-up changes per EC-4/5/6
 * (Agent.* static factories, agent-session-store pre-grep, CloudAgent
 * constructor mirror). Documented in commit body + CHANGELOG.
 *
 * **Contract scope:** types only. No runtime code, no imports from cycle
 * members. Pure leaf.
 *
 * **Historical note (SE40 / v4.0):** `conversation-storage-fs.ts` and the
 * `ConversationStorage` port named above were removed when the native session
 * transcript replaced the pluggable-adapter model. The cycle-break rationale
 * still holds — `SessionMessage` remains a leaf type shared by the runtime
 * (`agent-session.ts`) and the native store (`agent-session-store.ts`).
 *
 * @internal — NOT part of the `@theokit/sdk` public API.
 */

/**
 * One turn in an in-memory session — used by `agent-session.ts` (runtime
 * append/get/clear) and `agent-session-store.ts` (persistence serialize/
 * deserialize). The two layers historically shared this type via a direct
 * `agent-session.ts → store ← session.ts` edge; this leaf file is now the
 * single source of truth for both.
 */
export interface SessionMessage {
  role: "user" | "assistant";
  text: string;
}
