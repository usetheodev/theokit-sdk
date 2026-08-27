import { diag } from "../diagnostics.js";
import { defaultBaseDir, expandTilde } from "./session-transcript.js";

/** The subset of `LocalOptions` this resolver reads. */
interface SessionDirOptions {
  sessionDir?: string;
  baseDir?: string;
}

/**
 * Resolve the directory session transcripts are written to.
 *
 * #301 renamed `local.baseDir` to `local.sessionDir`. "Base directory" read as
 * the directory the agent works in, in an interface whose `cwd` is the option
 * that actually means that — and setting it to `"./"`, which is what the name
 * invites, ran without error and wrote `./projects/<encoded-cwd>/<id>.jsonl`
 * into the caller's repository root.
 *
 * Both names are read, `sessionDir` wins, and the old one warns instead of
 * failing: a rename is not worth breaking a build over, and a caller who never
 * sees the warning still gets the behaviour they had before.
 *
 * @internal
 */
/**
 * The session directory the caller ASKED for, or `undefined` when they asked for nothing.
 *
 * {@link resolveSessionDir} always answers with a path, falling back to the default home — which is
 * the right answer for "where do transcripts go" and the wrong one for "did this consumer opt into
 * sharing state with the Claude Code CLI". Memory writes need the second question, and the two
 * accepted names for the option live here, so asking it anywhere else would put a copy of that
 * knowledge somewhere it can drift.
 */
export function explicitSessionDir(local: SessionDirOptions | undefined): string | undefined {
  if (local?.sessionDir === undefined && local?.baseDir === undefined) return undefined;
  return resolveSessionDir(local);
}

export function resolveSessionDir(local: SessionDirOptions | undefined): string {
  if (local?.sessionDir !== undefined) {
    if (local.baseDir !== undefined) {
      diag(
        "[theokit-sdk] local.sessionDir and local.baseDir are both set; using sessionDir. " +
          "baseDir is the deprecated name for the same option (#301).",
      );
    }
    return expandTilde(local.sessionDir);
  }
  if (local?.baseDir !== undefined) {
    diag(
      "[theokit-sdk] local.baseDir is deprecated; rename it to local.sessionDir (#301). " +
        "It is the directory for session transcripts, not the working directory — that is local.cwd.",
    );
    return expandTilde(local.baseDir);
  }
  return defaultBaseDir();
}
