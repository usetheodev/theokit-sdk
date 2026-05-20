import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Idempotent setup of the shell-tool policy.
 *
 * On boot, writes two files into the workspace:
 *   - `.theokit/policy.js` — a small Node script the SDK runs as the
 *     `preToolUse` hook. Reads the tool payload on stdin, exits non-zero
 *     (= deny) when the shell command matches a danger pattern.
 *   - `.theokit/hooks/shell-policy.md` — the SDK's file-based hook config
 *     (markdown + YAML frontmatter, ADR D74) that wires the `preToolUse`
 *     event to the policy script for the `shell` tool.
 *
 * The SDK loads `.theokit/hooks/<name>.md` automatically when the agent
 * is created with `local.settingSources: ["project"]`. Note:
 * `workspace-seeds.ts` also writes the markdown shell-policy file via
 * its own `HOOK_SHELL_POLICY_MD` constant — this setup runs first and
 * ensureFile is idempotent, so the seed call later is a no-op when the
 * file already exists.
 *
 * @internal to the example
 */

const POLICY_SCRIPT = `#!/usr/bin/env node
let data = "";
process.stdin.on("data", (chunk) => {
  data += chunk;
});
process.stdin.on("end", () => {
  try {
    const payload = JSON.parse(data);
    const cmd =
      (payload.input && typeof payload.input.command === "string"
        ? payload.input.command
        : "") || "";
    // Block: rm, sudo, dd, mkfs, append-redirects to system paths.
    if (/(^|\\s)(rm|sudo|dd|mkfs|shutdown|reboot|kill)(\\s|$)/.test(cmd)) {
      process.stderr.write("Policy denied: dangerous shell command (" + cmd + ")");
      process.exit(1);
    }
    if (/>>?\\s*\\/(etc|var|usr|bin|boot|root)/.test(cmd)) {
      process.stderr.write("Policy denied: redirect into system path (" + cmd + ")");
      process.exit(1);
    }
  } catch (_) {
    // Malformed payload → fail-open (the SDK's stricter type checks will catch it).
  }
  process.exit(0);
});
`;

const SHELL_POLICY_MD = `---
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

async function ensureFile(path: string, contents: string, mode?: number): Promise<void> {
  try {
    await stat(path);
    return; // already exists; leave alone (user may have edited)
  } catch {
    // doesn't exist, create
  }
  await writeFile(path, contents, mode !== undefined ? { mode } : {});
}

export async function ensureHooksPolicy(cwd: string): Promise<void> {
  const dir = join(cwd, ".theokit");
  await mkdir(dir, { recursive: true });
  await mkdir(join(dir, "hooks"), { recursive: true });
  await ensureFile(join(dir, "policy.js"), POLICY_SCRIPT, 0o755);
  // ADR D74: markdown config, 1 file per entity. Markdown wins via D77;
  // any legacy .theokit/hooks.json next to it triggers a "remove" warn.
  await ensureFile(join(dir, "hooks", "shell-policy.md"), SHELL_POLICY_MD);
}
