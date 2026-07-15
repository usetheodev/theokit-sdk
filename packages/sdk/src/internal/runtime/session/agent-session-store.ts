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

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { ConversationStep, ConversationTurn } from "../../../types/conversation.js";
import { withFileLock } from "../../persistence/file-lock.js";
import {
  type AssistantTurn,
  readTranscript,
  reconstructMessages,
  type SessionRecord,
  SessionTranscript,
  transcriptPath,
  writeTranscript,
} from "../../persistence/session-transcript.js";
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

/** Options identifying the on-disk transcript for one agent. */
export interface TranscriptLocation {
  baseDir: string;
  cwd: string;
  agentId: string;
  model: string;
}

/**
 * Read the persisted transcript and reconstruct the resumable session history,
 * narrowed to the in-memory {@link SessionMessage} shape (user/assistant text).
 * Tool turns fold into assistant-role context so resume keeps tool history.
 */
export async function readSessionMessages(
  baseDir: string,
  cwd: string,
  agentId: string,
): Promise<SessionMessage[]> {
  const records = await readTranscript(transcriptPath(baseDir, cwd, agentId));
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

/**
 * Persist one conversation turn (user + assistant/tool records) to the native
 * transcript, append-only. Seeds the parent chain from the on-disk records under
 * a cross-process file lock so concurrent processes never tear the DAG.
 */
export async function persistTurn(
  loc: TranscriptLocation,
  sessionId: string,
  turn: PersistTurnInput,
): Promise<void> {
  const path = transcriptPath(loc.baseDir, loc.cwd, loc.agentId);
  // mkdir BEFORE the lock: withFileLock's companion `<path>.lock` needs the parent dir.
  await mkdir(dirname(path), { recursive: true });
  await withFileLock(path, async () => {
    const prior = await readTranscript(path);
    const transcript = seedTranscript(prior, { cwd: loc.cwd, sessionId, model: loc.model });
    transcript.appendUserTurn(turn.userText);
    appendConversation(transcript, turn.conversation);
    await writeTranscript(path, transcript.records());
  });
}

/**
 * Append-only compaction: add a `compact_boundary` system record (a new root) so
 * resume replays only the post-boundary continuation. NEVER shrinks the line set.
 */
export async function appendCompactBoundaryRecord(
  loc: TranscriptLocation,
  sessionId: string,
  meta: { preTokens: number; trigger: string },
): Promise<void> {
  const path = transcriptPath(loc.baseDir, loc.cwd, loc.agentId);
  await mkdir(dirname(path), { recursive: true });
  await withFileLock(path, async () => {
    const prior = await readTranscript(path);
    const transcript = seedTranscript(prior, { cwd: loc.cwd, sessionId, model: loc.model });
    transcript.appendCompactBoundary(meta);
    await writeTranscript(path, transcript.records());
  });
}
