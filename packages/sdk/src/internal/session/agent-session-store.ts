/**
 * SE40 — native session store over the Claude-shaped `.jsonl` transcript.
 *
 * The theokit session format IS the Claude Code record shape (see
 * `../../persistence/session-transcript.ts`). This module owns the FS lifecycle:
 * read existing records, seed a {@link SessionTranscript}'s parent chain, append
 * the new turn (user + assistant/tool blocks), and write append-only. Compaction
 * appends a `compact_boundary` record (a new root) — it NEVER shrinks the line
 * set (that would break the DAG). Reads reconstruct `LlmMessage[]` via
 * {@link reconstructMessages}, narrowed to the in-memory {@link SessionMessage}.
 *
 * @internal
 */

import type { ConversationStep, ConversationTurn } from "../../types/conversation.js";
import type { SessionStore } from "../../types/session-store.js";
import {
  type AssistantTurn,
  reconstructMessages,
  type SessionRecord,
  SessionTranscript,
} from "../persistence/session-transcript.js";
import type { SessionMessage } from "./session-types.js";

/**
 * Seed a {@link SessionTranscript} from the already-on-disk records so a new
 * append parents correctly on the existing DAG leaf. The transcript re-emits the
 * seeded records verbatim before the new turn, so the whole file rewrites atomically
 * as one append-only line set. Returns the transcript primed with the prior records.
 */
function seedTranscript(
  prior: readonly SessionRecord[],
  opts: { cwd: string; sessionId: string; model: string },
): SessionTranscript {
  return SessionTranscript.fromRecords(prior, opts);
}

/** The turn to persist: the user's text plus the rich per-turn conversation view. */
export interface PersistTurnInput {
  userText: string;
  conversation: readonly ConversationTurn[];
  /**
   * M50 — when supplied, size-driven auto-compaction runs in the SAME write chain after the turn
   * persists (usage real vs the model's context window; summarizer injected by the caller).
   */
  autoCompact?: {
    usageTotal?: number | undefined;
    contextWindow?: number | undefined;
    summarize: (
      messages: readonly import("../../compaction.js").CompressibleMessage[],
    ) => Promise<string>;
  };
}

interface MappedTurn {
  assistant: AssistantTurn;
  toolResults: Array<{ toolUseId: string; content: string; isError?: boolean }>;
}

/** Fold one agent turn's steps into an assistant record + paired tool results. */
function mapAgentTurn(steps: readonly ConversationStep[]): MappedTurn {
  const assistant: AssistantTurn = {};
  const toolResults: MappedTurn["toolResults"] = [];
  const toolCalls: NonNullable<AssistantTurn["toolCalls"]> = [];
  for (const step of steps) {
    if (step.type === "thinkingMessage") assistant.thinking = step.message.text;
    else if (step.type === "assistantMessage") assistant.text = step.message.text;
    else if (step.type === "toolCall")
      toolCalls.push({
        id: step.message.callId,
        name: step.message.name,
        input: (step.message.args as Record<string, unknown> | undefined) ?? {},
      });
    else
      toolResults.push({
        toolUseId: step.message.callId,
        content: step.message.result,
        isError: step.message.isError,
      });
  }
  if (toolCalls.length > 0) assistant.toolCalls = toolCalls;
  return { assistant, toolResults };
}

/** True when the assistant record carries any content worth emitting. */
function hasAssistantContent(a: AssistantTurn): boolean {
  return a.text !== undefined || a.thinking !== undefined || (a.toolCalls?.length ?? 0) > 0;
}

/**
 * Map the rich `ConversationTurn[]` (from `run.conversation()`) into the native
 * assistant/tool records. One transcript turn is: an `assistant` record carrying
 * thinking + text + tool_use blocks, then (when present) a `user` record carrying
 * the paired tool_result blocks. Tool results pair with tool_use by `callId`.
 */
function appendConversation(
  transcript: SessionTranscript,
  conversation: readonly ConversationTurn[],
): void {
  for (const ct of conversation) {
    if (ct.type !== "agentConversationTurn") continue;
    const { assistant, toolResults } = mapAgentTurn(ct.turn.steps);
    if (hasAssistantContent(assistant)) transcript.appendAssistantTurn(assistant);
    if (toolResults.length > 0) transcript.appendToolResults(toolResults);
  }
}

/**
 * The per-agent transcript metadata used to seed a {@link SessionTranscript}. The
 * actual record I/O goes through the injected {@link SessionStore} (SE41), so this
 * no longer carries a `baseDir` — the store is already bound to its location.
 */
export interface TranscriptLocation {
  cwd: string;
  agentId: string;
  model: string;
}

/**
 * Read the session's records via the {@link SessionStore} and reconstruct the
 * resumable history, narrowed to the in-memory {@link SessionMessage} shape
 * (user/assistant text). Tool turns fold into assistant-role context so resume
 * keeps tool history. Works identically for the FS default and an external store.
 */
export async function readSessionMessages(
  store: SessionStore,
  agentId: string,
): Promise<SessionMessage[]> {
  const records = await store.readRecords(agentId);
  return reconstructMessages(records).map(narrowToSessionMessage);
}

type NarrowPart = { type: string; text?: string; content?: unknown; name?: string };

/** Render one reconstructed content part as folded session text. */
function partToText(p: NarrowPart): string {
  if (p.type === "text") return p.text ?? "";
  if (p.type === "tool_use") return `[tool call] ${p.name ?? ""}`;
  if (p.type === "tool_result") {
    const body = typeof p.content === "string" ? p.content : JSON.stringify(p.content);
    return `[tool result] ${body}`;
  }
  return "";
}

/** Flatten a reconstructed `LlmMessage` to the narrowed in-memory `SessionMessage`. */
function narrowToSessionMessage(m: {
  role: "system" | "user" | "assistant";
  content: NarrowPart[];
}): SessionMessage {
  const role = m.role === "user" ? "user" : "assistant";
  const text = m.content
    .map(partToText)
    .filter((s) => s.length > 0)
    .join("\n");
  return { role, text };
}

/** The records appended by the last turn (the delta beyond the seeded prior). */
function deltaRecords(
  transcript: SessionTranscript,
  priorLength: number,
): readonly SessionRecord[] {
  return transcript.records().slice(priorLength);
}

/**
 * Persist one conversation turn (user + assistant/tool records) to the session
 * store, append-only. Reads the prior records to seed the parent chain, folds the
 * new turn, and appends ONLY the delta via {@link SessionStore.appendRecords}
 * (the store owns the append atomicity — the FS default serializes under a file
 * lock). Within one process, turns for an agent are already chained upstream, so
 * the read→append is ordered; cross-host ordering is the external store's contract.
 */
export async function persistTurn(
  store: SessionStore,
  loc: TranscriptLocation,
  sessionId: string,
  turn: PersistTurnInput,
): Promise<void> {
  const prior = await store.readRecords(loc.agentId);
  const transcript = seedTranscript(prior, { cwd: loc.cwd, sessionId, model: loc.model });
  transcript.appendUserTurn(turn.userText);
  appendConversation(transcript, turn.conversation);
  await store.appendRecords(loc.agentId, deltaRecords(transcript, prior.length));
}

/**
 * Append-only compaction: add a `compact_boundary` system record (a new root) so
 * resume replays only the post-boundary continuation. Appends only the boundary
 * record via the store — NEVER rewrites or shrinks the prior records.
 */
export async function appendCompactBoundaryRecord(
  store: SessionStore,
  loc: TranscriptLocation,
  sessionId: string,
  meta: { preTokens: number; trigger: string },
): Promise<void> {
  const prior = await store.readRecords(loc.agentId);
  const transcript = seedTranscript(prior, { cwd: loc.cwd, sessionId, model: loc.model });
  transcript.appendCompactBoundary(meta);
  await store.appendRecords(loc.agentId, deltaRecords(transcript, prior.length));
}
