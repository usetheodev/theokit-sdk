/**
 * `SessionRecord` — the native on-disk transcript record shape (SE40).
 *
 * The theokit session format IS the Claude Code record shape: a
 * `uuid`/`parentUuid` DAG of records with structured
 * `text`/`tool_use`/`tool_result`/`thinking` blocks. This is the contract the
 * pluggable {@link SessionStore} seam operates over.
 *
 * DIP-correct home (SE46): the contract lives in the domain `types/` layer;
 * the application-layer DAG core (`internal/persistence/session-transcript.ts`)
 * re-exports it for back-compat while owning the record builders + reader.
 *
 * @public
 */

/** One transcript record (one JSONL line). `message` absent on `system` (compact_boundary) records. */
export interface SessionRecord {
  type: "user" | "assistant" | "system";
  uuid: string;
  parentUuid: string | null;
  sessionId: string;
  timestamp: string;
  isSidechain?: boolean;
  userType?: string;
  cwd?: string;
  version?: string;
  subtype?: string;
  compactMetadata?: { preTokens: number; trigger: string };
  message?: Record<string, unknown>;
}
