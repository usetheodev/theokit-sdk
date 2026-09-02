/**
 * The foreign configuration dialects this SDK can read, and what each one PRESUMES.
 *
 * ## Why a registry and not a list of directory names
 *
 * `projectConfigRoots` returned `[".theokit", ".claude"]` — two paths — and that shape is what
 * usetheokit/theokit-sdk#522 fell through. A path says WHERE a file lives. It does not say how the
 * file is parsed, and it does not say what runtime the commands inside it were written against.
 *
 * Claude Code defines `$CLAUDE_PROJECT_DIR` for the hook commands in its `settings.json`, and its
 * documentation tells authors to reach project files through it — an absolute path would break for
 * every other person on the team, so the shape that failed here is the shape upstream recommends.
 * This SDK read the file and ran the command without the variable. `sh` expands an unset variable to
 * the empty string, so
 *
 *     bash "$CLAUDE_PROJECT_DIR/.claude/hooks/guard.sh"   became   bash "/.claude/hooks/guard.sh"
 *
 * which does not exist, which a hook runner correctly reads as a refusal. Every turn denied, in any
 * repository that also had Claude Code set up, with a message naming a file that was present and
 * executable all along.
 *
 * Importing a format means accepting the contract that format presumes. An adapter is where that
 * contract is written down, so the next dialect (`.codex/` is the obvious one) declares its own
 * instead of inheriting a hole.
 *
 * ## What an adapter deliberately does NOT do
 *
 * It does not make the foreign source trusted, and it does not make its hooks permissive: a script
 * that exits non-zero is still a refusal. It supplies the variables the format's authors were
 * entitled to assume, and nothing else — `env` here is merged over the scrubbed inherit policy by
 * `spawnAndCollect`, so it adds names rather than widening what a child can see.
 *
 * @internal
 */

/**
 * The project config directory literal.
 *
 * Renamed from `THEOKIT_DIR_NAME` in #410. Sharing a name with the (now removed) sovereign env var
 * was the MECHANISM of that defect, not scenery: every grep for the variable landed on that const
 * and looked answered, so "is it read?" returned five hits and nobody checked what they were.
 *
 * Lives here rather than in `persistence/paths.ts` because a directory name is one third of what a
 * dialect is — the other two being how it parses and what it presumes — and splitting the three
 * across two modules is what let the third go unwritten.
 */
export const THEOKIT_DIR_LITERAL = ".theokit";

/** The Claude Code CLI's project configuration directory. */
export const CLAUDE_DIR_NAME = ".claude";

/** A configuration dialect this SDK understands. `theokit` is native; the rest are foreign. */
export interface ConfigSourceAdapter {
  /** Stable identifier, and what a consumer names to opt in. */
  readonly kind: string;
  /** The project-relative directory the dialect keeps its configuration in. */
  readonly dirName: string;
  /**
   * Variables the dialect's own runtime defines for commands it executes.
   *
   * Empty for the native source: a `.theokit/` hook is written against THIS runtime and inherits it
   * already. Non-empty is what makes a foreign command runnable rather than silently broken.
   */
  runtimeEnv(cwd: string): Record<string, string>;
}

/** The native source. Always read, never opted into, always first for precedence. */
export const NATIVE_SOURCE: ConfigSourceAdapter = {
  kind: "theokit",
  dirName: THEOKIT_DIR_LITERAL,
  runtimeEnv: () => ({}),
};

/**
 * Claude Code.
 *
 * `CLAUDE_PROJECT_DIR` is the documented way for a hook command in `settings.json` to reach a file
 * in the project. Only that one variable is supplied: `$CLAUDE_PLUGIN_ROOT` and the rest of that
 * runtime's surface are NOT defined here, because supplying a name whose value this SDK would have
 * to invent is worse than leaving it unset — an invented root sends a script somewhere real and
 * wrong, where an unset one fails loudly.
 */
export const CLAUDE_CODE_SOURCE: ConfigSourceAdapter = {
  kind: "claude-code",
  dirName: CLAUDE_DIR_NAME,
  runtimeEnv: (cwd) => ({ CLAUDE_PROJECT_DIR: cwd }),
};

const BY_DIR_NAME: ReadonlyMap<string, ConfigSourceAdapter> = new Map(
  [NATIVE_SOURCE, CLAUDE_CODE_SOURCE].map((a) => [a.dirName, a]),
);

/**
 * The adapter whose directory an absolute config path sits under, or `undefined` for a path that
 * belongs to no registered dialect.
 *
 * Matched on the path SEGMENT rather than with `includes`, so a workspace that happens to live under
 * `/home/me/.claude-backups/repo` does not read as a Claude Code source.
 */
export function adapterForConfigPath(path: string): ConfigSourceAdapter | undefined {
  for (const segment of path.split(/[\\/]/)) {
    const adapter = BY_DIR_NAME.get(segment);
    if (adapter !== undefined) return adapter;
  }
  return undefined;
}

/**
 * Variable references in a shell command that nothing will define.
 *
 * The second half of #522, and the half that cost the debugging session. `sh` expands an unset
 * variable to the empty string and says nothing, so the failure surfaces ten characters later as a
 * path: `bash: /.claude/hooks/guard.sh: No such file or directory` — which reads as "your script is
 * missing" while the script is present and executable. Nothing in that message contains the name of
 * the variable that was actually missing, so the reader looks in the wrong place.
 *
 * Checked against BOTH the process environment and the variables the dialect supplies, because
 * either is a legitimate source: a hook may reasonably use `$HOME`.
 *
 * ## What it deliberately does not try to be
 *
 * This is not a shell parser. It finds `$NAME` and `${NAME}` outside single quotes, which is the
 * shape a config file's hook commands take. It does NOT understand `${NAME:-default}` (a default
 * makes the variable optional, so it is not reported), assignments earlier in the same command, or
 * variables a sourced script exports. A false NEGATIVE there costs the old behaviour — the confusing
 * path error — and a false positive would deny a hook that would have worked, so the parse errs
 * toward silence and the check only ever ADDS a name to a failure that already happened.
 */
export function undefinedVariablesIn(
  command: string,
  supplied: Readonly<Record<string, string>>,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string[] {
  // Single-quoted spans are literal in `sh`: `echo '$FOO'` prints the dollar sign.
  const unquoted = command.replace(/'[^']*'/g, " ");
  const names = new Set<string>();
  for (const match of unquoted.matchAll(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
  )) {
    const name = match[1] ?? match[2];
    if (name === undefined) continue;
    if (name in supplied) continue;
    if (env[name] !== undefined) continue;
    names.add(name);
  }
  return [...names];
}
