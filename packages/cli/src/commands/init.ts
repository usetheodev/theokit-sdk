/**
 * `theokit init [project-name]` — scaffold a new project from a bundled
 * template (T2.1, ADRs D196 + D200).
 *
 * Exit codes: `0` success (and cancelled prompt — Ctrl+C at a prompt is not an error);
 * `2` user error (missing name in non-interactive mode, unknown template, invalid npm name,
 * destination not empty without `--force`); `1` anything else, including a destination that is a
 * symlink.
 *
 * @internal
 */

import * as p from "@clack/prompts";
import pc from "picocolors";

import { SCAFFOLD_USER_ERROR_CODES, scaffold } from "../init/scaffold.js";
import { DEFAULT_TEMPLATE, findTemplate, TEMPLATES } from "../init/templates.js";

/** Flags for {@link runInit}, mirroring the `theokit init` options. */
export interface InitOptions {
  /** Template name. Prompted for when interactive and omitted; otherwise defaults to `minimal`. */
  template?: string;
  /** Allow a non-empty destination — it is DELETED and replaced, not merged into. */
  force?: boolean;
  /** Skip prompts (CI mode). Implied when stdin or stdout is not a TTY. */
  yes?: boolean;
}

async function resolveProjectName(
  projectName: string | undefined,
  skipPrompts: boolean,
): Promise<string | { exitCode: number }> {
  if (projectName !== undefined && projectName.length > 0) return projectName;
  if (skipPrompts) {
    process.stderr.write(
      `${pc.red("error: ")}project name is required in non-interactive mode. Pass it as the positional argument: ${pc.cyan(
        "theokit init <project-name>",
      )}\n`,
    );
    return { exitCode: 2 };
  }
  const answer = await p.text({
    message: "Project name?",
    placeholder: "my-bot",
    validate: (v) => (v.length === 0 ? "Required." : undefined),
  });
  if (p.isCancel(answer)) return { exitCode: 0 };
  return answer;
}

async function resolveTemplate(
  optsTemplate: string | undefined,
  skipPrompts: boolean,
): Promise<string | { exitCode: number }> {
  let template = optsTemplate ?? DEFAULT_TEMPLATE;
  if (optsTemplate === undefined && !skipPrompts) {
    const answer = await p.select({
      message: "Pick a template:",
      options: TEMPLATES.map((t) => ({ value: t.name, label: t.name, hint: t.description })),
      initialValue: DEFAULT_TEMPLATE,
    });
    if (p.isCancel(answer)) return { exitCode: 0 };
    template = answer as string;
  }
  if (findTemplate(template) === undefined) {
    process.stderr.write(
      `${pc.red("error: ")}unknown template "${template}". Available: ${TEMPLATES.map((t) => t.name).join(", ")}\n`,
    );
    return { exitCode: 2 };
  }
  return template;
}

// #353 — derived from the scaffolder rather than restated here. The hand-written copy was missing
// `dest_is_symlink`, so a symlinked destination exited 1 ("unknown error") for what is squarely a
// user mistake, and a CI job branching on 1 vs 2 routed it to the branch that pages someone.
const USER_ERROR_CODES: ReadonlySet<string> = new Set(SCAFFOLD_USER_ERROR_CODES);

async function runScaffold(name: string, template: string, force: boolean): Promise<number> {
  try {
    const result = await scaffold({
      projectName: name,
      template,
      cwd: process.cwd(),
      ...(force ? { force: true } : {}),
    });
    process.stdout.write(
      `\n${pc.green("✓")} Scaffolded ${pc.bold(name)} (${template}) — ${result.filesWritten} files written.\n` +
        `\nNext steps:\n` +
        `  ${pc.cyan(`cd ${name}`)}\n` +
        `  ${pc.cyan("pnpm install")}\n` +
        `  ${pc.cyan("cp .env.example .env")}  ${pc.gray("# edit your keys")}\n` +
        `  ${pc.cyan("pnpm dev")}\n\n` +
        `Template hint: ${findTemplate(template)?.hint ?? ""}\n`,
    );
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string }).code ?? "unknown";
    process.stderr.write(`${pc.red("error:")} ${message}\n  ${pc.gray(`(code: ${code})`)}\n`);
    return USER_ERROR_CODES.has(code) ? 2 : 1;
  }
}

/**
 * Scaffold `./<project-name>` from a bundled template, resolving the name and template
 * interactively when it can.
 *
 * Prompts are used only on a real TTY (both stdin and stdout) and only when `--yes` was not passed.
 * Without a TTY the name becomes mandatory and the template falls back to `minimal`, so the same
 * command behaves differently under a pipe than in a terminal.
 *
 * The destination is always `<cwd>/<project-name>` — a name that would escape cwd is refused. With
 * `force`, an existing destination is REMOVED before the new tree is moved into place; there is no
 * merge and no backup.
 *
 * There is no scaffold-in-place option. `--here` used to be advertised and ignored (#351), and it
 * was removed rather than implemented because the writer cannot honour it: the tree is built in a
 * temp directory and moved into place with `rm` + `rename`, so a destination equal to `cwd` would
 * mean deleting the directory the process is running in. Writing in place needs a second write path
 * with weaker atomicity, which is a feature to ask for, not a flag to quietly repair.
 *
 * Returns the process exit code (0 / 2 / 1 as described at the top of this file). Cancelling a
 * prompt returns 0 and writes nothing.
 */
export async function runInit(projectName: string | undefined, opts: InitOptions): Promise<number> {
  const isTty = process.stdin.isTTY === true && process.stdout.isTTY === true;
  const skipPrompts = opts.yes === true || !isTty;

  const name = await resolveProjectName(projectName, skipPrompts);
  if (typeof name !== "string") return name.exitCode;

  const template = await resolveTemplate(opts.template, skipPrompts);
  if (typeof template !== "string") return template.exitCode;

  return runScaffold(name, template, opts.force === true);
}
