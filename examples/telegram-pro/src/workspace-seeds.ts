import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Read the SKILL.md content of a named skill from `.theokit/skills/<name>/`.
 * Used by the `/skill <name>` Telegram command (ADR D57). Sanitizes the
 * skill name via regex to prevent path traversal (`../etc` → `etc` after
 * sanitization → returns undefined as that skill doesn't exist).
 *
 * @returns the file content as UTF-8 string, or undefined if file missing
 *   or name sanitized to empty.
 */
export async function readSkillFile(cwd: string, name: string): Promise<string | undefined> {
  // EC-D57: strip anything that isn't [a-z0-9_-] (case-insensitive). Cannot
  // accept `../`, `/`, `\\`, absolute paths, or any other escape sequence.
  const safeName = name.replace(/[^a-z0-9_-]/gi, "");
  if (safeName.length === 0) return undefined;
  try {
    return await readFile(join(cwd, ".theokit", "skills", safeName, "SKILL.md"), "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Idempotent workspace seeders.
 *
 * Writes the static, ship-with-the-example files into the user's workspace
 * on boot:
 *   - `.theokit/skills/<name>/SKILL.md` — two example skills
 *   - `.theokit/plugins.json`           — provider plugin manifest
 *   - `.theokit/context.json`           — sources injected into system prompt
 *   - `.theokit/memory/wiki/*.md`       — seed wiki corpus for `/wiki` recall
 *
 * Each seeder skips if the target already exists so user edits aren't
 * clobbered between restarts.
 *
 * @internal to the example
 */

async function ensureFile(path: string, contents: string): Promise<void> {
  try {
    await stat(path);
    return; // exists; leave alone
  } catch {
    // fall through
  }
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, contents, "utf8");
}

// ────────────────────── skills ──────────────────────

const RECIPE_SKILL = `---
name: recipe-suggest
description: Suggest a quick weeknight dinner recipe given the user's dietary preferences and what's in the fridge. Output: 1 recipe with ingredients list + 5-step procedure.
---

When invoked, output the recipe in this Markdown shape:

# <Dish name>

**Why this:** one-line rationale tying to the user's preferences.

## Ingredients
- ...

## Steps
1. ...
2. ...
3. ...

Keep it simple — ingredients available at any supermarket. No exotic tools.
`;

const MORNING_SKILL = `---
name: morning-routine
description: Generate a personalized morning routine for the user. Pulls remembered facts about their schedule, fitness goals, and breakfast preferences from memory before composing.
---

Before composing the routine, call memory_search({ query: "morning", corpus: "memory" }) to pull personalized facts.

Output:
- Wake time
- 3-item morning checklist (drink water, ...)
- Breakfast suggestion that matches their stated preferences
- One motivational sentence to start the day

Tone: warm but brief. Never longer than 8 lines total.
`;

// ────────────────────── plugins (removed in markdown-config-migration) ──────────────────────
//
// The top-level .theokit/plugins.json was never consumed by the SDK — it
// was a documentation-only seed. The real plugin loader reads
// .theokit/plugins/<name>/PLUGIN.md (or legacy plugin.json) per-folder.
// We no longer write plugins.json; if a user wants to declare a plugin,
// they create .theokit/plugins/<name>/PLUGIN.md following ADR D74.

// ────────────────────── context ──────────────────────

const CONTEXT_MD = `---
name: bot-readme
path: README.md
---

# Bot README context

The bot's own \`README.md\` is injected as context so the agent can answer
"what can you do?" / "how do I use you?" questions from chat without us
having to maintain a separate \`/help\` text duplicated from the README.

Update both \`README.md\` and this file's prose together when the bot gains
new commands.
`;

// ────────────────────── hooks (markdown — ADR D74) ──────────────────────

const HOOK_SHELL_POLICY_MD = `---
event: preToolUse
matcher: ^shell$
command: node .theokit/policy.js
---

# Shell tool policy gate

Vets every \`shell\` tool invocation before it spawns. \`policy.js\` (committed
alongside this file) inspects the command + args for destructive patterns
(\`rm -rf\`, \`kill\`, force-push) and exits non-zero to block.

## Why this exists

Telegram chat is multi-user — anyone in the allowed-users list can ask the
bot to "run a quick test command". Without a gate, we trust user prompts
to shape shell calls. The gate enforces an allowlist.
`;

// ────────────────────── wiki seed ──────────────────────

const WIKI_TOOLS = `# Available tools

- **memory_search**: search memory/sessions/wiki corpora
- **memory_get**: read a memory file by path
- **shell**: run shell commands (rm/sudo/dd/mkfs/shutdown/reboot/kill blocked)
- **filesystem MCP**: list_directory, read_file, write_file, create_directory, search_files
- **task** (subagent dispatch): delegate to \`code_writer\` or \`researcher\`

## Skills
- **recipe-suggest**: quick weeknight dinner recipe
- **morning-routine**: personalized morning routine

## Slash commands
- /start /help /me /recall /summary /cron /remind /reset /agents /skills /wiki
`;

const WIKI_DEPLOYMENT = `# Deployment notes

This bot is a single-process Node.js app that talks to Telegram via long-polling.

**State on disk** (cwd = workspace root):
- \`.theokit/agents/registry.json\` — registry of all chat agents
- \`.theokit/agents/<id>/messages.jsonl\` — per-agent conversation history
- \`.theokit/memory/MEMORY.md\` — explicit facts (auto-write on "Remember: ...")
- \`.theokit/memory/sessions/<runId>.md\` — per-run summaries (corpus="sessions")
- \`.theokit/memory/wiki/*.md\` — read-only knowledge base (corpus="wiki")
- \`.theokit/memory/notes/*.md\` — dreaming-sweep output (consolidations)
- \`.theokit/cron/jobs.json\` — registered cron jobs
- \`.theokit/cache/vision/*.txt\` — sticker / photo description cache
- \`.theokit/hooks.json\` + \`.theokit/policy.js\` — shell policy

**Per ADRs D17–D21**, restart-proof: kill -9 the process, restart, conversation continues.

**Run-as-one-process-per-workspace**. Co-locating two SDK processes on the same cwd races on registry.json. Cross-process locks are v1.x.
`;

// ────────────────────── entry point ──────────────────────

export async function seedWorkspace(cwd: string): Promise<void> {
  const skills = join(cwd, ".theokit", "skills");
  await ensureFile(join(skills, "recipe-suggest", "SKILL.md"), RECIPE_SKILL);
  await ensureFile(join(skills, "morning-routine", "SKILL.md"), MORNING_SKILL);
  // Markdown configs (ADR D74). ensureFile is idempotent — won't overwrite
  // user edits (EC-10 fix).
  await ensureFile(join(cwd, ".theokit", "context", "bot-readme.md"), CONTEXT_MD);
  await ensureFile(join(cwd, ".theokit", "hooks", "shell-policy.md"), HOOK_SHELL_POLICY_MD);
  const wiki = join(cwd, ".theokit", "memory", "wiki");
  await ensureFile(join(wiki, "tools.md"), WIKI_TOOLS);
  await ensureFile(join(wiki, "deployment.md"), WIKI_DEPLOYMENT);
}
