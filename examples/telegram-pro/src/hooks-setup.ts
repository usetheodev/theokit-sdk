import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Idempotent setup of the shell-tool policy.
 *
 * On boot, writes two files into the workspace:
 *   - `.theokit/policy.js` — a small Node script the SDK runs as the
 *     `preToolUse` hook. Reads the tool payload on stdin, exits non-zero
 *     (= deny) when the shell command matches a danger pattern.
 *   - `.theokit/hooks.json` — the SDK's file-based hook config that wires
 *     the `preToolUse` event to the policy script for the `shell` tool.
 *
 * The SDK loads `.theokit/hooks.json` automatically when the agent is
 * created with `local.settingSources: ["project"]`.
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

const HOOKS_JSON = JSON.stringify(
  {
    hooks: {
      preToolUse: [{ matcher: "^shell$", command: "node .theokit/policy.js" }],
    },
  },
  null,
  2,
);

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
  await ensureFile(join(dir, "policy.js"), POLICY_SCRIPT, 0o755);
  await ensureFile(join(dir, "hooks.json"), HOOKS_JSON);
}
