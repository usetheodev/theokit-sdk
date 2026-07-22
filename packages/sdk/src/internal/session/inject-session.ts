/**
 * M51 (agent-builder) — inject a SYNTHETIC user+assistant pair into a session's persisted transcript
 * WITHOUT running an LLM turn. This is the Codex review-exit mechanism (`exit_success.xml` appended to
 * the parent thread history so follow-ups like "fix finding 2" work): the pair chains onto the DAG
 * leaf (M50 pattern) and the in-memory cache is invalidated so the NEXT send re-hydrates with it.
 */
import type { SessionStore } from "../../types/session-store.js";
import { SessionTranscript } from "../persistence/session-transcript.js";
import { enqueueSessionWrite, invalidateSessionCache } from "./agent-session.js";
import type { CompactLocation } from "./compact-session.js";

export async function injectSessionTurn(opts: {
  store: SessionStore;
  loc: CompactLocation;
  sessionId: string;
  userText: string;
  assistantText: string;
}): Promise<void> {
  await enqueueSessionWrite(opts.loc.cwd, opts.loc.agentId, async () => {
    const prior = await opts.store.readRecords(opts.loc.agentId);
    const transcript = SessionTranscript.fromRecords(prior, {
      cwd: opts.loc.cwd,
      sessionId: opts.sessionId,
      model: opts.loc.model ?? "unknown",
    });
    transcript.appendUserTurn(opts.userText);
    transcript.appendAssistantTurn({ text: opts.assistantText });
    await opts.store.appendRecords(opts.loc.agentId, transcript.records().slice(prior.length));
    invalidateSessionCache(opts.loc.cwd, opts.loc.agentId);
  });
}
