import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

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

// ────────────────────── plugins ──────────────────────

const PLUGINS_JSON = JSON.stringify(
  {
    plugins: [
      {
        name: "openrouter-routing",
        type: "provider",
        // Declarative manifest: tells the SDK that this plugin contributes
        // an OpenRouter chat provider. The actual key still comes from env.
        provider: { id: "openrouter", capability: "chat", priority: 1 },
      },
    ],
  },
  null,
  2,
);

// ────────────────────── context ──────────────────────

const CONTEXT_JSON = JSON.stringify(
  {
    // Files listed here are read at agent.create / send time and injected
    // into the system prompt as "<context_source name>...</context_source>".
    // We point at our own README so the agent knows about its own commands.
    sources: [
      {
        name: "bot-readme",
        path: "README.md",
      },
    ],
  },
  null,
  2,
);

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
  await ensureFile(join(cwd, ".theokit", "plugins.json"), PLUGINS_JSON);
  await ensureFile(join(cwd, ".theokit", "context.json"), CONTEXT_JSON);
  const wiki = join(cwd, ".theokit", "memory", "wiki");
  await ensureFile(join(wiki, "tools.md"), WIKI_TOOLS);
  await ensureFile(join(wiki, "deployment.md"), WIKI_DEPLOYMENT);
}
