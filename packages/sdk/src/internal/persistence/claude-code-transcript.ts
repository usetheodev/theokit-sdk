/**
 * SE39 — Claude Code transcript writer (best-effort, READ-ONLY interop).
 *
 * Emits `@theokit/sdk` sessions as a Claude-Code-compatible `.jsonl` so the ecosystem's read-side
 * tools (`claude-code-log`, `ccusage`, viewers) can parse them. Opt-in and ADDITIVE — it does not
 * touch `ConversationStorage`. It taps `SendOptions.onStep` (the only surface that preserves the
 * `tool_use_id ↔ tool_result` pairing via the LLM `call.id`).
 *
 * WARNING: the Claude Code `.jsonl` entry format is internal to Claude Code and changes between
 * versions (Anthropic recommends `/export`). This writer targets a known-good shape and is validated
 * by a round-trip test against the real `claude-code-log` parser. Functional `--continue` (real CLI
 * resume, extended-thinking signatures, sidecar dirs) is deferred to SE40.
 *
 * referencia: knowledge-base/references/claude-code-log/claude_code_log/models.py (schema authority)
 */
import { homedir } from "node:os";
import { join } from "node:path";
import type { ConversationStep } from "../../types/conversation.js";
import { redactSecrets } from "../security/redact.js";
import { replaceFileAtomic } from "./atomic-write.js";

/** A single Claude-Code transcript record (one JSONL line). */
export interface ClaudeCodeRecord {
  type: "user" | "assistant";
  uuid: string;
  parentUuid: string | null;
  isSidechain: boolean;
  userType: string;
  cwd: string;
  sessionId: string;
  version: string;
  timestamp: string;
  message: Record<string, unknown>;
}

export interface ClaudeCodeTranscriptOptions {
  /** Working directory stamped on each record + used to derive the default output dir. */
  cwd?: string;
  /** Session id (the `.jsonl` filename). Defaults to a generated id. */
  sessionId?: string;
  /** Model id stamped on assistant records. */
  model?: string;
  /** `version` field — pin a known-good Claude Code schema version. */
  version?: string;
  /** Override the output directory. Default: `~/.claude/projects/<encoded-cwd>/`. */
  dir?: string;
}

interface MapOptions {
  userMessage: string;
  cwd: string;
  sessionId: string;
  model: string;
  version: string;
  timestamp: string;
}

/** Claude Code path convention: cwd with every non-alphanumeric replaced by `-`. */
export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

const red = (s: string): string => redactSecrets(s);

/**
 * Deep-redact a structured value (tool `input`/`args`) by round-tripping through the string
 * redactor: secrets are masked in every string value while the object shape is preserved (masked
 * tokens are alphanumeric + dots, so the JSON stays valid). Security is never sacrificed — tool
 * arguments frequently carry credentials, so they MUST be redacted like every other content field.
 */
function redactValue(value: unknown): unknown {
  try {
    return JSON.parse(redactSecrets(JSON.stringify(value ?? null)));
  } catch {
    // Non-serializable input (circular, BigInt, …): fall back to a redacted string form.
    return redactSecrets(String(value));
  }
}

/**
 * Make a caller-supplied `sessionId` safe as a filename path component — no `.`/`/`/`\` so it can
 * never traverse out of the target dir (`../../etc/x` → `------etc-x`). Applied once and reused for
 * both the path and the stamped `sessionId` field.
 */
function safeSessionId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "-");
}

type Block = Record<string, unknown>;

/**
 * Map an ordered `onStep` sequence into Claude Code records. The initial user prompt is the root;
 * consecutive assistant-side steps (thinking/text/toolCall) collapse into ONE assistant record, and
 * consecutive tool results collapse into ONE user record — mirroring the Anthropic message shape.
 * `parentUuid` chains each record to the previous one (a single DAG path); tool_result blocks carry
 * the originating `tool_use.id` so the pairing has zero dangling.
 */
export function claudeCodeRecords(
  steps: readonly ConversationStep[],
  opts: MapOptions,
): ClaudeCodeRecord[] {
  const records: ClaudeCodeRecord[] = [];
  let n = 0;
  let prev: string | null = null;
  const nextId = (): string => `${opts.sessionId}-${n++}`;

  const push = (type: "user" | "assistant", message: Record<string, unknown>): void => {
    const uuid = nextId();
    records.push({
      type,
      uuid,
      parentUuid: prev,
      isSidechain: false,
      userType: "external",
      cwd: opts.cwd,
      sessionId: opts.sessionId,
      version: opts.version,
      timestamp: opts.timestamp,
      message,
    });
    prev = uuid;
  };

  // Root: the user prompt.
  push("user", { role: "user", content: [{ type: "text", text: red(opts.userMessage) }] });

  let asst: Block[] = [];
  let results: Block[] = [];
  const flushAsst = (): void => {
    if (asst.length === 0) return;
    push("assistant", {
      id: `${opts.sessionId}-msg-${records.length}`,
      type: "message",
      role: "assistant",
      model: opts.model,
      content: asst,
    });
    asst = [];
  };
  const flushResults = (): void => {
    if (results.length === 0) return;
    push("user", { role: "user", content: results });
    results = [];
  };

  for (const s of steps) {
    if (s.type === "toolResult") {
      flushAsst();
      results.push({
        type: "tool_result",
        tool_use_id: s.message.callId,
        content: red(s.message.result),
        is_error: s.message.isError,
      });
      continue;
    }
    // any assistant-side step closes a pending result batch first
    flushResults();
    if (s.type === "thinkingMessage") {
      asst.push({ type: "thinking", thinking: red(s.message.text) });
    } else if (s.type === "assistantMessage") {
      asst.push({ type: "text", text: red(s.message.text) });
    } else if (s.type === "toolCall") {
      asst.push({
        type: "tool_use",
        id: s.message.callId,
        name: s.message.name,
        input: redactValue(s.message.args),
      });
    }
  }
  flushAsst();
  flushResults();
  return records;
}

/**
 * SE39 — opt-in Claude Code transcript writer. Uniform `X.create()` (ADR 0015). Pass `.onStep` to
 * `agent.send(msg, { onStep })`, then `write(msg)` to persist the `.jsonl`.
 *
 * @public
 */
export class ClaudeCodeTranscriptWriter {
  #steps: ConversationStep[] = [];
  #cwd: string;
  #sessionId: string;
  #model: string;
  #version: string;
  #dir: string;

  private constructor(opts: ClaudeCodeTranscriptOptions) {
    this.#cwd = opts.cwd ?? process.cwd();
    // Sanitize: a caller-supplied sessionId becomes a filename component — never let it traverse.
    this.#sessionId = safeSessionId(opts.sessionId ?? `theokit-${Date.now().toString(36)}`);
    this.#model = opts.model ?? "unknown";
    this.#version = opts.version ?? "1.0.0-theokit";
    this.#dir = opts.dir ?? join(homedir(), ".claude", "projects", encodeProjectDir(this.#cwd));
  }

  static create(opts: ClaudeCodeTranscriptOptions = {}): ClaudeCodeTranscriptWriter {
    return new ClaudeCodeTranscriptWriter(opts);
  }

  /** Pass to `SendOptions.onStep`. Accumulates the run's steps. Bound so it can be passed by value. */
  onStep = (args: { step: ConversationStep }): void => {
    this.#steps.push(args.step);
  };

  /** The mapped records for the accumulated steps + the given prompt (pure; no I/O). */
  records(userMessage: string): ClaudeCodeRecord[] {
    return claudeCodeRecords(this.#steps, {
      userMessage,
      cwd: this.#cwd,
      sessionId: this.#sessionId,
      model: this.#model,
      version: this.#version,
      timestamp: new Date().toISOString(),
    });
  }

  /** The `.jsonl` path this writer targets: `<dir>/<sessionId>.jsonl`. */
  get path(): string {
    return join(this.#dir, `${this.#sessionId}.jsonl`);
  }

  /** Write the transcript to `<dir>/<sessionId>.jsonl` (atomic). Returns the path. */
  async write(userMessage: string): Promise<string> {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(this.#dir, { recursive: true });
    const body = this.records(userMessage)
      .map((r) => JSON.stringify(r))
      .join("\n");
    await replaceFileAtomic(this.path, `${body}\n`);
    return this.path;
  }
}
