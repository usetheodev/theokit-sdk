/**
 * Closed-enum of all canonical span names emitted by the SDK telemetry layer.
 *
 * Wiring discipline (T0.1 + downstream tasks):
 * - `agent.create`         — emitted in `Agent.create` static factory (T0.1).
 * - `agent.send`           — parent span wrapping `LocalAgent.send` (T0.1).
 * - `agent.send.<step>`    — 8 child spans inside `sendLocked` (T1.7).
 * - `memory.recall`        — entry to `runActiveMemory` (T0.1).
 * - `tool.call`            — per tool invocation in `tool-dispatch` (T2.4).
 * - `llm.call`             — per provider HTTP turn (T3.*).
 *
 * Using a closed `as const` map (NOT `string`) means downstream span emitters
 * cannot drift names: they read a key off `SPAN_NAMES`, so a typo is a compile
 * error rather than a silently divergent span. ADR D438 anticipates the
 * "no string-literal escape hatch in public unions" rule for SDK internals.
 *
 * B-140: a derived `SpanName` literal union was exported here and consumed by
 * nothing — every emitter reaches for the const, not the type. Removed rather
 * than left advertising a second way in that no caller had ever taken.
 *
 * @internal
 */
export const SPAN_NAMES = {
  AGENT_CREATE: "agent.create",
  AGENT_SEND: "agent.send",
  AGENT_SEND_HYDRATE: "agent.send.hydrate",
  AGENT_SEND_MODEL_OVERRIDE: "agent.send.model_override",
  AGENT_SEND_PRE_HOOK: "agent.send.pre_hook",
  AGENT_SEND_PRE_USER_SEND: "agent.send.pre_user_send",
  AGENT_SEND_MEMORY_RECALL: "agent.send.memory_recall",
  AGENT_SEND_SYSTEM_PROMPT: "agent.send.system_prompt",
  AGENT_SEND_DISPATCH: "agent.send.dispatch",
  AGENT_SEND_POST_REPLY: "agent.send.post_reply",
  MEMORY_RECALL: "memory.recall",
  TOOL_CALL: "tool.call",
  LLM_CALL: "llm.call",
} as const;

/** Histogram names emitted by the SDK. M3 #64 closes the wiring-triad pillar-c
 * gap: tool/LLM durations + LLM token throughput were measured but never emitted. */
export const HISTOGRAM_NAMES = {
  MEMORY_RECALL_DURATION_MS: "theokit_memory_recall_duration_ms",
  TOOL_CALL_DURATION_MS: "theokit_tool_call_duration_ms",
  LLM_CALL_DURATION_MS: "theokit_llm_call_duration_ms",
  LLM_TOKENS: "theokit_llm_tokens",
  /** M3 #66 — count of finishes where the provider omitted usage (silent undercount). */
  LLM_USAGE_MISSING: "theokit_llm_usage_missing",
} as const;
