/**
 * `createInMemoryMarkdownProvider` — first concrete `MemoryProvider`
 * impl shipped in `@theokit/sdk-memory` (SDK 2.0 Phase 1 / T1.6).
 *
 * Goal: prove the contract works end-to-end with a real (non-no-op)
 * impl WITHOUT pulling LanceDB / embedding / circuit-breaker infrastructure.
 * That richer impl lands in subsequent iters.
 *
 * Semantics:
 *   - Stores recalled facts in a per-agent in-process Map.
 *   - `runActivePass()` returns the facts plus a `systemPromptAdditions`
 *     string that joins fact contents with newlines (so the LLM sees
 *     them in the system slot).
 *   - `buildTools()` surfaces a `memory_remember(content)` tool the LLM
 *     can call to persist a fact mid-conversation.
 *   - `recordSessionSummary()` writes a markdown summary to
 *     `${cwd}/.theokit/memory/sessions/${runId}.md` (real disk write
 *     via `@theokit/sdk/internal/persistence` per ADR-008).
 *   - `dispose()` clears the handle's per-agent map (releases memory).
 *
 * @public
 */

import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { replaceFileAtomic } from "@theokit/sdk/internal/persistence";
import type {
  ActiveMemoryPassArgs,
  ActiveMemoryPassResult,
  CustomTool,
  MemoryAdapter,
  MemoryAdapterCapabilities,
  MemoryContext,
  MemoryFact,
  MemoryId,
  MemoryProvider,
  MemoryProviderHandle,
  MemoryProviderInitOptions,
  MemoryTurnMessage,
  RecordSessionSummaryArgs,
  SDKAgent,
} from "@theokit/sdk";

/** Adapter id prefix — namespaces minted MemoryIds so cross-adapter delete is safe (EC-B). */
const ADAPTER_ID = "in-memory-md";

/** Per-agent state holder. Stored on the handle via the opaque symbol slot. */
interface InMemoryHandleState {
  readonly facts: Map<string, MemoryFact>;
  readonly counter: { next: number };
  /**
   * Workspace cwd captured at `init()` time. Used by `runActivePass()`
   * to read previously-written session summaries from disk for recall
   * (iter 34 — closes the "write but never read" gap from iter 33).
   */
  readonly cwd: string;
  /**
   * `sessions: true` capability is set when cwd is available (always),
   * so future Stage 3 work can mark this provider as the canonical
   * sessions-recall path (vs. the no-op default).
   */
}

const INTERNAL_STATE = Symbol("sdk-memory.in-memory.state");

function buildCapabilities(): MemoryAdapterCapabilities {
  return {
    history: false,
    sessions: false,
    tenancy: false,
    reasoning: false,
    toolSchemas: false,
    prefetch: false,
  };
}

function buildAdapter(state: InMemoryHandleState): MemoryAdapter {
  return {
    id: ADAPTER_ID,
    capabilities: buildCapabilities(),
    isAvailable(): boolean {
      return true;
    },
    async write(content: string | MemoryTurnMessage[], _ctx: MemoryContext): Promise<MemoryId> {
      const text = typeof content === "string" ? content : content.map((m) => m.content).join("\n");
      const id = `${ADAPTER_ID}:${state.counter.next++}` as MemoryId;
      state.facts.set(id, {
        id,
        content: text,
        createdAt: new Date().toISOString(),
      });
      return id;
    },
    async recall(_query: string, _ctx: MemoryContext, k?: number): Promise<MemoryFact[]> {
      // Naive recall — return everything (cap at k). Real impls in
      // subsequent iters add semantic similarity via embeddings.
      const all = Array.from(state.facts.values());
      const limit = k !== undefined && k >= 0 ? k : all.length;
      return all.slice(0, limit);
    },
    async delete(id: MemoryId): Promise<void> {
      if (!String(id).startsWith(`${ADAPTER_ID}:`)) {
        throw new Error(
          `MemoryAdapter.delete: id "${String(id)}" was not minted by adapter "${ADAPTER_ID}"`,
        );
      }
      state.facts.delete(id);
    },
  };
}

/** Truncate session-summary text fields to bound disk size. */
const MAX_SUMMARY_TURN_CHARS = 2000;

function truncate(text: string): string {
  if (text.length <= MAX_SUMMARY_TURN_CHARS) return text;
  return `${text.slice(0, MAX_SUMMARY_TURN_CHARS)}…`;
}

/**
 * Sanitize a runId for use as a filename. Strip path separators +
 * traversal patterns; keep `[a-zA-Z0-9_-]`; cap at 128 chars.
 * Mirrors sdk-core's legacy `writeSessionSummary` sanitizer so the
 * file-path semantics are identical across paths.
 */
function sanitizeRunId(runId: string): string {
  return runId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 128);
}

/** Render the session-summary markdown body. */
function renderSessionSummaryMarkdown(args: RecordSessionSummaryArgs): string {
  const iso = new Date(args.at).toISOString();
  return [
    "---",
    `runId: ${args.runId}`,
    `agentId: ${args.agentId}`,
    `at: ${iso}`,
    `status: ${args.status}`,
    "---",
    "",
    "## User",
    "",
    truncate(args.userText),
    "",
    "## Assistant",
    "",
    truncate(args.assistantText),
    "",
  ].join("\n");
}

/**
 * Read previously-written session summaries from disk + substring-
 * match against the user message. Best-effort: errors degrade to
 * empty recall (no throw — matches the non-throwing-on-hot-path
 * contract).
 *
 * Iter 34: this is the SUBSTRING-match version. Future iters can
 * upgrade to embedding-based semantic similarity (LanceDB ANN)
 * without changing the public surface.
 *
 * Cap: returns at most 5 hits to bound the systemPromptAdditions size.
 */
async function recallSessionSummaries(
  cwd: string,
  userMessage: string,
): Promise<ReadonlyArray<MemoryFact>> {
  const RECALL_CAP = 5;
  const sessionsDir = join(cwd, ".theokit", "memory", "sessions");
  let files: string[];
  try {
    files = await readdir(sessionsDir);
  } catch {
    return [];
  }
  const query = userMessage.toLowerCase().trim();
  if (query.length === 0) return [];
  const hits: MemoryFact[] = [];
  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    if (hits.length >= RECALL_CAP) break;
    const filePath = join(sessionsDir, file);
    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      continue;
    }
    if (content.toLowerCase().includes(query)) {
      // Extract a short snippet — the User section (first 200 chars).
      const userIdx = content.indexOf("## User");
      const snippet =
        userIdx >= 0 ? content.slice(userIdx, userIdx + 200).replace(/\s+/g, " ") : file;
      const id = `${ADAPTER_ID}:session:${file}` as MemoryId;
      hits.push({
        id,
        content: snippet,
        score: 0.5, // substring-match has no real score; placeholder
      });
    }
  }
  return hits;
}

function buildMemoryRememberTool(state: InMemoryHandleState): CustomTool {
  return {
    name: "memory_remember",
    description:
      "Persist a short fact about the user/conversation to memory so it can be recalled in future turns. Pass a single concise sentence as `content`.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The fact to remember (one sentence)." },
      },
      required: ["content"],
      additionalProperties: false,
    },
    handler: async (input: Record<string, unknown>): Promise<string> => {
      const content = typeof input.content === "string" ? input.content : "";
      if (content.length === 0) {
        return JSON.stringify({ ok: false, error: "empty content" });
      }
      const id = `${ADAPTER_ID}:${state.counter.next++}` as MemoryId;
      state.facts.set(id, {
        id,
        content,
        createdAt: new Date().toISOString(),
      });
      return JSON.stringify({ ok: true, id });
    },
  };
}

/**
 * Build a fresh `MemoryProvider` whose facts live in-process. The
 * returned provider is independent — call `createInMemoryMarkdownProvider()`
 * per agent OR share across agents (each `init()` gets its own state).
 *
 * Iter 33: `recordSessionSummary()` writes session-summary markdown
 * files to disk under `${cwd}/.theokit/memory/sessions/`.
 * Iter 34: `runActivePass()` reads back those summaries + substring-
 * matches against the user message for genuine cross-session recall.
 *
 * Future LanceDB-backed impl will replace the substring match with
 * semantic-similarity ANN over embedding vectors.
 */
export function createInMemoryMarkdownProvider(): MemoryProvider {
  return {
    async init(opts: MemoryProviderInitOptions): Promise<MemoryProviderHandle> {
      const state: InMemoryHandleState = {
        facts: new Map(),
        counter: { next: 0 },
        cwd: opts.cwd,
      };
      const adapter = buildAdapter(state);
      return {
        adapter,
        [INTERNAL_STATE]: state,
      };
    },
    buildTools(handle: MemoryProviderHandle, _agent: SDKAgent): ReadonlyArray<CustomTool> {
      const state = handle[INTERNAL_STATE] as InMemoryHandleState | undefined;
      if (state === undefined) return [];
      return [buildMemoryRememberTool(state)];
    },
    async runActivePass(
      handle: MemoryProviderHandle,
      args: ActiveMemoryPassArgs,
    ): Promise<ActiveMemoryPassResult> {
      const state = handle[INTERNAL_STATE] as InMemoryHandleState | undefined;
      if (state === undefined) return { facts: [] };
      // (1) In-process facts (from memory_remember tool calls this turn).
      const inProcessFacts = Array.from(state.facts.values());
      // (2) Persisted session-summary recall — iter 34. Read previously-
      // written summaries from disk + substring-match against the user
      // message. Best-effort: read errors degrade to empty recall.
      const persistedHits = await recallSessionSummaries(state.cwd, args.userMessage);
      const allFacts = [...inProcessFacts, ...persistedHits];
      if (allFacts.length === 0) return { facts: [] };
      const systemPromptAdditions = [
        "Known facts about the user/session (recall):",
        ...allFacts.map((f) => `- ${f.content}`),
      ].join("\n");
      return { facts: allFacts, systemPromptAdditions };
    },
    sync(_handle: MemoryProviderHandle): void {
      // No-op for the in-memory impl — facts are written synchronously to
      // the Map at handler-call time; nothing to re-index post-run. Future
      // LanceDB-backed impl will fire IndexManager.sync() here.
      return;
    },
    async recordSessionSummary(args: RecordSessionSummaryArgs): Promise<void> {
      // Real filesystem write via `@theokit/sdk/internal/persistence`'s
      // `replaceFileAtomic`. ADR-008 sub-path resolution guarantees the
      // same process-level write lock as sdk-core's legacy
      // `writeSessionSummary`. Future LanceDB-backed impl additionally
      // triggers IndexManager re-sync after the write.
      if (args.status !== "finished") return;
      const sessionsPath = join(args.cwd, ".theokit", "memory", "sessions");
      const filePath = join(sessionsPath, `${sanitizeRunId(args.runId)}.md`);
      await mkdir(sessionsPath, { recursive: true });
      const body = renderSessionSummaryMarkdown(args);
      await replaceFileAtomic(filePath, body);
    },
    dispose(handle: MemoryProviderHandle): void {
      const state = handle[INTERNAL_STATE] as InMemoryHandleState | undefined;
      if (state === undefined) return;
      state.facts.clear();
    },
  };
}
