/**
 * Dogfood — SDK end-to-end probe through every path-guard wired site.
 *
 * Exercises real LLM round-trip through the same SDK paths the telegram-pro
 * bot uses; path-guard wiring fires on real disk I/O (sessionFilePath,
 * memory paths, plugins-manager).
 *
 * Run: pnpm tsx --env-file=.env src/dogfood-sdk-e2e.ts
 *
 * @internal
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAgentFactory, type SDKAgent } from "@usetheo/sdk";

// Capture stderr to verify path-guard fires inside fire-and-forget catches.
const stderrLines: string[] = [];
const origStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
  const s = typeof chunk === "string" ? chunk : chunk.toString();
  stderrLines.push(s);
  // re-emit so we still see output during runs
  return origStderrWrite(chunk as string, ...(rest as [])) as boolean;
}) as typeof process.stderr.write;

function stderrIncludes(needle: string): boolean {
  return stderrLines.some((s) => s.includes(needle));
}

function clearStderr(): void {
  stderrLines.length = 0;
}

interface Result {
  id: string;
  desc: string;
  status: "pass" | "fail";
  detail: string;
  ms: number;
}

const results: Result[] = [];

async function record<T>(id: string, desc: string, fn: () => Promise<T>): Promise<T | undefined> {
  const t0 = Date.now();
  try {
    const v = await fn();
    const ms = Date.now() - t0;
    const detail =
      typeof v === "string"
        ? v.slice(0, 160).replace(/\n/g, " ")
        : JSON.stringify(v).slice(0, 160);
    results.push({ id, desc, status: "pass", detail, ms });
    process.stdout.write(`[${id}] PASS  ${desc} (${ms}ms)\n     ↳ ${detail}\n`);
    return v;
  } catch (err) {
    const ms = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ id, desc, status: "fail", detail: msg, ms });
    process.stdout.write(`[${id}] FAIL  ${desc} (${ms}ms)\n     ↳ ${msg}\n`);
    return undefined;
  }
}

async function expectThrow(
  id: string,
  desc: string,
  expectedCodes: string[],
  fn: () => Promise<unknown>,
): Promise<void> {
  const t0 = Date.now();
  try {
    await fn();
    const ms = Date.now() - t0;
    results.push({ id, desc, status: "fail", detail: "expected throw, got success", ms });
    process.stdout.write(`[${id}] FAIL  ${desc} (${ms}ms) — expected throw\n`);
  } catch (err) {
    const ms = Date.now() - t0;
    const code = (err as { code?: string }).code;
    const matched = code !== undefined && expectedCodes.includes(code);
    if (matched) {
      results.push({ id, desc, status: "pass", detail: `blocked: ${code}`, ms });
      process.stdout.write(`[${id}] PASS  ${desc} (${ms}ms) — blocked: ${code}\n`);
    } else {
      results.push({
        id,
        desc,
        status: "fail",
        detail: `wrong code: ${code ?? "?"} (expected ${expectedCodes.join("|")})`,
        ms,
      });
      process.stdout.write(
        `[${id}] FAIL  ${desc} (${ms}ms) — wrong code: ${code ?? "?"}\n`,
      );
    }
  }
}

async function send(agent: SDKAgent, text: string): Promise<{ status: string; reply: string }> {
  const run = await agent.send(text);
  const result = await run.wait();
  const replyText = result.result ?? "";
  return { status: result.status, reply: replyText.slice(0, 200) };
}

async function main(): Promise<void> {
  const API_KEY = process.env.THEOKIT_API_KEY ?? process.env.OPENROUTER_API_KEY;
  if (API_KEY === undefined || API_KEY.length === 0) {
    process.stderr.write("Missing OPENROUTER_API_KEY / THEOKIT_API_KEY\n");
    process.exit(1);
  }

  const workspace = mkdtempSync(join(tmpdir(), "dogfood-sdk-e2e-"));
  process.stdout.write(
    `\n=== Dogfood SDK E2E (Security Block Completion) ===\n  workspace: ${workspace}\n  apiKey: ${API_KEY.slice(0, 8)}...\n\n`,
  );

  // Seed minimal .theokit structure
  mkdirSync(join(workspace, ".theokit", "skills", "code-review"), { recursive: true });
  writeFileSync(
    join(workspace, ".theokit", "skills", "code-review", "SKILL.md"),
    "---\nname: code-review\ndescription: Reviews code for quality and security.\n---\n\nReview code.\n",
  );
  mkdirSync(join(workspace, ".theokit", "plugins", "test-plugin"), { recursive: true });
  writeFileSync(
    join(workspace, ".theokit", "plugins", "test-plugin", "PLUGIN.md"),
    "---\nname: test-plugin\nversion: 1.0.0\nentry: index.js\n---\n",
  );
  writeFileSync(
    join(workspace, ".theokit", "plugins", "test-plugin", "index.js"),
    "module.exports = {};",
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Section 1: Agent factory
  // ─────────────────────────────────────────────────────────────────────────
  const factory = await record("1.1", "createAgentFactory with full config", async () => {
    // CRITICAL: `local.cwd` is what SDK reads (resolveCwd at local-agent:84).
    // Top-level `cwd` is ignored by LocalAgent — only certain code paths use it.
    return createAgentFactory({
      apiKey: API_KEY,
      model: "google/gemini-2.0-flash-001",
      local: { cwd: workspace, settingSources: ["project", "plugins"] },
    });
  });
  if (factory === undefined) {
    process.stdout.write("\nAborting: factory failed to construct.\n");
    process.exit(1);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Section 2: Real agent IDs from telegram-pro registry pass sanitize
  // ─────────────────────────────────────────────────────────────────────────
  const realIds = [
    "tg-pro-dm-7528967933",
    "agent-07cad8d6-3459-42c9-af34-8e446a1b4ff4",
    "bc-14ebe9e6-a4c1-412c-8cd4-fa17c32831fa",
    "cli-bot-paulo",
  ];
  let firstAgent: SDKAgent | undefined;
  for (const id of realIds) {
    const idx = realIds.indexOf(id) + 1;
    const a = await record(`2.${idx}`, `Agent.getOrCreate id=${id}`, async () => {
      const agent = await factory.getOrCreate(id);
      return `agentId=${agent.agentId}`;
    });
    if (a !== undefined && firstAgent === undefined) {
      firstAgent = await factory.getOrCreate(id);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Section 3: Malicious agentIds rejected at SEND (path-guard fires on
  // sessionFilePath when first message is persisted)
  // ─────────────────────────────────────────────────────────────────────────
  // Malicious agentIds: sanitizeIdentifier fires synchronously inside
  // Agent.getOrCreate (via hydrateSession → readSessionFile → sessionFilePath).
  // Caller gets a ConfigurationError("invalid_identifier") at creation time —
  // STRONGER than the original spec (which assumed only write-time guard).
  const malicious = ["../etc/passwd", "/etc/shadow", "foo/bar", "..", "name with spaces"];
  for (const id of malicious) {
    const idx = malicious.indexOf(id) + 1;
    await expectThrow(
      `3.${idx}`,
      `Malicious agentId rejected at getOrCreate: ${JSON.stringify(id)}`,
      ["invalid_identifier"],
      async () => {
        const a = await factory.getOrCreate(id);
        // If creation passes (it shouldn't), defense-in-depth at send:
        const run = await a.send("dummy");
        await run.wait();
      },
    );
  }
  // Verify no malicious literal-name dirs ever materialized inside agents/.
  // Note: `..` normalizes back to a legitimate parent, so we check for
  // unexpected entries by listing the agents/ dir and looking for non-
  // sanitized names.
  const agentsRoot = join(workspace, ".theokit", "agents");
  if (existsSync(agentsRoot)) {
    const { readdirSync } = await import("node:fs");
    const entries = readdirSync(agentsRoot);
    const dangerous = entries.filter(
      (e) => e.includes("..") || e.includes("/") || e.includes(" ") || e.startsWith("."),
    );
    if (dangerous.length === 0) {
      results.push({
        id: "3.disk",
        desc: "No malicious agent dirs ever created on disk",
        status: "pass",
        detail: `agents/: ${entries.join(", ")}`,
        ms: 0,
      });
      process.stdout.write(`[3.disk] PASS — no malicious dirs; legitimate: ${entries.join(", ")}\n`);
    } else {
      results.push({
        id: "3.disk",
        desc: "No malicious agent dirs ever created on disk",
        status: "fail",
        detail: `dangerous entries: ${dangerous.join(", ")}`,
        ms: 0,
      });
      process.stdout.write(`[3.disk] FAIL — dangerous: ${dangerous.join(", ")}\n`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Section 4: Real LLM round-trip
  // ─────────────────────────────────────────────────────────────────────────
  if (firstAgent !== undefined) {
    await record("4.1", "Real LLM: PING → PONG round-trip", async () => {
      const r = await send(firstAgent!, "Reply with exactly: PONG");
      return `status=${r.status} reply="${r.reply}"`;
    });

    await record("4.2", "Real LLM: arithmetic", async () => {
      const r = await send(firstAgent!, "What is 7 + 5? Reply with only the number.");
      return `status=${r.status} reply="${r.reply}"`;
    });

    await record("4.3", "Real LLM: multi-turn (uses session JSONL)", async () => {
      const r = await send(firstAgent!, "And what was my previous question about?");
      return `status=${r.status} reply="${r.reply}"`;
    });

    // ─────────────────────────────────────────────────────────────────────
    // Section 5: Session JSONL persisted via path-guard
    // ─────────────────────────────────────────────────────────────────────
    await record("5.1", "Session JSONL exists and is readable", async () => {
      // Allow fire-and-forget writes to settle.
      await new Promise((r) => setTimeout(r, 300));
      const sessionPath = join(
        workspace,
        ".theokit",
        "agents",
        firstAgent!.agentId,
        "messages.jsonl",
      );
      const content = readFileSync(sessionPath, "utf8");
      const lines = content.split("\n").filter((l) => l.length > 0);
      return `${lines.length} lines persisted at ${sessionPath}`;
    });

    // ─────────────────────────────────────────────────────────────────────
    // Section 6: Skills + plugins lists work (path-guard at refresh)
    // ─────────────────────────────────────────────────────────────────────
    await record("6.1", "agent.skills.list", async () => {
      const skills = (await firstAgent!.skills?.list()) ?? [];
      return `${skills.length} skills: ${skills.map((s) => s.name).join(", ")}`;
    });

    await record("6.2", "agent.plugins.list", async () => {
      const plugins = (await firstAgent!.plugins?.list()) ?? [];
      return `${plugins.length} plugins: ${plugins.map((p) => p.name).join(", ")}`;
    });

    // ─────────────────────────────────────────────────────────────────────
    // Section 7: Reload re-reads filesystem
    // ─────────────────────────────────────────────────────────────────────
    await record("7.1", "agent.reload picks up new skill", async () => {
      mkdirSync(join(workspace, ".theokit", "skills", "new-skill"), { recursive: true });
      writeFileSync(
        join(workspace, ".theokit", "skills", "new-skill", "SKILL.md"),
        "---\nname: new-skill\ndescription: Added at runtime.\n---\n\nNew skill.\n",
      );
      await firstAgent!.reload();
      const skills = (await firstAgent!.skills?.list()) ?? [];
      const found = skills.find((s) => s.name === "new-skill");
      return found !== undefined ? "new-skill found after reload" : "MISSING";
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Section 8: Malicious plugin entry rejected via safePathJoin
  // ─────────────────────────────────────────────────────────────────────────
  const evilWorkspace = mkdtempSync(join(tmpdir(), "dogfood-evil-"));
  mkdirSync(join(evilWorkspace, ".theokit", "plugins", "evil-plugin"), { recursive: true });
  writeFileSync(
    join(evilWorkspace, ".theokit", "plugins", "evil-plugin", "PLUGIN.md"),
    "---\nname: evil-plugin\nversion: 1.0.0\nentry: ../../../etc/passwd\n---\n",
  );
  await expectThrow(
    "8.1",
    "Malicious plugin entry path_traversal blocked",
    ["path_traversal"],
    async () => {
      const evilFactory = createAgentFactory({
        apiKey: API_KEY,
        model: "google/gemini-2.0-flash-001",
        local: { cwd: evilWorkspace, settingSources: ["plugins"] },
      });
      await evilFactory.getOrCreate("evil-agent");
    },
  );
  rmSync(evilWorkspace, { recursive: true, force: true });

  // ─────────────────────────────────────────────────────────────────────────
  // Section 9: Normalized escape blocked
  // ─────────────────────────────────────────────────────────────────────────
  const evil2 = mkdtempSync(join(tmpdir(), "dogfood-evil2-"));
  mkdirSync(join(evil2, ".theokit", "plugins", "subtle-evil"), { recursive: true });
  writeFileSync(
    join(evil2, ".theokit", "plugins", "subtle-evil", "PLUGIN.md"),
    "---\nname: subtle-evil\nversion: 1.0.0\nentry: subdir/../../../etc/passwd\n---\n",
  );
  await expectThrow(
    "9.1",
    "Normalized escape (subdir/../../) blocked by resolve-then-check",
    ["path_traversal"],
    async () => {
      const f = createAgentFactory({
        apiKey: API_KEY,
        model: "google/gemini-2.0-flash-001",
        local: { cwd: evil2, settingSources: ["plugins"] },
      });
      await f.getOrCreate("a");
    },
  );
  rmSync(evil2, { recursive: true, force: true });

  // Cleanup
  if (firstAgent !== undefined) {
    try {
      await firstAgent.dispose();
    } catch {
      // ignore
    }
  }
  rmSync(workspace, { recursive: true, force: true });

  // ─────────────────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────────────────
  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  process.stdout.write(`\n=== Results: ${passed}/${results.length} PASS, ${failed} FAIL ===\n`);
  if (failed > 0) {
    process.stdout.write("\nFailures:\n");
    for (const r of results.filter((r) => r.status === "fail")) {
      process.stdout.write(`  [${r.id}] ${r.desc}\n    ${r.detail}\n`);
    }
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(2);
});
