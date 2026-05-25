/**
 * `theokit init [project-name]` — scaffold a new project from a bundled
 * template (T2.1, ADRs D196 + D200).
 *
 * @internal
 */

import * as p from "@clack/prompts";
import pc from "picocolors";

import { scaffold } from "../init/scaffold.js";
import { DEFAULT_TEMPLATE, findTemplate, TEMPLATES } from "../init/templates.js";

export interface InitOptions {
  template?: string;
  force?: boolean;
  here?: boolean;
  yes?: boolean;
}

export async function runInit(projectName: string | undefined, opts: InitOptions): Promise<number> {
  const isTty = process.stdin.isTTY === true && process.stdout.isTTY === true;
  const skipPrompts = opts.yes === true || !isTty;

  // Resolve project name.
  let name = projectName;
  if (name === undefined || name.length === 0) {
    if (skipPrompts) {
      process.stderr.write(
        pc.red("error: ") +
          "project name is required in non-interactive mode. Pass it as the positional argument: " +
          pc.cyan("theokit init <project-name>") +
          "\n",
      );
      return 2;
    }
    const answer = await p.text({
      message: "Project name?",
      placeholder: "my-bot",
      validate: (v) => (v.length === 0 ? "Required." : undefined),
    });
    if (p.isCancel(answer)) return 0;
    name = answer;
  }

  // Resolve template.
  let template = opts.template ?? DEFAULT_TEMPLATE;
  if (opts.template === undefined && !skipPrompts) {
    const answer = await p.select({
      message: "Pick a template:",
      options: TEMPLATES.map((t) => ({
        value: t.name,
        label: t.name,
        hint: t.description,
      })),
      initialValue: DEFAULT_TEMPLATE,
    });
    if (p.isCancel(answer)) return 0;
    template = answer as string;
  }
  if (findTemplate(template) === undefined) {
    process.stderr.write(
      pc.red("error: ") +
        `unknown template "${template}". Available: ${TEMPLATES.map((t) => t.name).join(", ")}\n`,
    );
    return 2;
  }

  // Scaffold.
  try {
    const result = await scaffold({
      projectName: name,
      template,
      cwd: process.cwd(),
      ...(opts.force === true ? { force: true } : {}),
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
    return code === "invalid_project_name" ||
      code === "dest_not_empty" ||
      code === "invalid_dest" ||
      code === "unknown_template"
      ? 2
      : 1;
  }
}
